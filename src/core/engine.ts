/**
 * Stateful calculator engine: variables, Ans, memory, user library, history.
 * Framework-free; used by the web UI, the desktop/mobile apps, the SDK and the API.
 */
import type { MathNode } from 'mathjs';
import { createMath, assertSafe, toNumber, parseWith, resetBudget, ChildScope, type CalciMath, type MathConfig, type AngleUnit } from './math.js';
import { normalizeInput, extractBraces } from './normalize.js';
import { setWorkBudget } from './compile.js';
import { formatValue, exactForm, expressionTex, DEFAULT_FORMAT, type FormatOptions, type ExactForm } from './format.js';

export interface CalculatorSettings extends FormatOptions, MathConfig {}

export const DEFAULT_SETTINGS: CalculatorSettings = {
  ...DEFAULT_FORMAT,
  angle: 'rad',
  bignumber: false,
  precision: 64,
  safe: false,
};

export type ResultKind = 'number' | 'complex' | 'matrix' | 'unit' | 'boolean' | 'function' | 'string' | 'other' | 'empty' | 'error';

export interface EvalResult {
  ok: boolean;
  input: string;
  normalized: string;
  kind: ResultKind;
  text: string;
  tex: string;
  inputTex?: string;
  exact?: ExactForm | null;
  value?: unknown;
  /** Name of a variable or function that was assigned. */
  assigned?: string;
  error?: string;
}

export interface Variable {
  name: string;
  text: string;
  tex: string;
  isFunction: boolean;
}

const RESERVED = new Set(['ans', 'Ans', 'M']);

/** Turn math.js error messages into friendlier ones. */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  let m: RegExpMatchArray | null;
  if ((m = msg.match(/Undefined symbol (\S+)/))) return `Unknown variable “${m[1]}”`;
  if ((m = msg.match(/Undefined function (\S+)/))) return `Unknown function “${m[1]}”`;
  if (/Unexpected end of expression/.test(msg)) return 'Incomplete expression';
  if ((m = msg.match(/Parenthesis \) expected/))) return 'Missing closing parenthesis';
  if ((m = msg.match(/Unexpected operator (\S+)/))) return `Unexpected “${m[1]}”`;
  if ((m = msg.match(/Value expected \(char (\d+)\)/))) return `Value expected at position ${m[1]}`;
  if (/Unexpected type of argument/.test(msg)) return msg.replace(/\(.*?\)/, '').replace(/Unexpected type of argument in function (\w+).*/, 'Invalid argument for $1');
  if (/Too many arguments|Too few arguments/.test(msg)) return msg.replace(/\(.*\)$/, '').trim();
  if (/Dimension mismatch/.test(msg)) return 'Dimension mismatch';
  if (/Cannot convert/.test(msg)) return msg;
  return msg.replace(/\s*\(char \d+\)$/, '');
}

function kindOf(math: CalciMath, v: unknown): ResultKind {
  if (v === undefined || v === null) return 'empty';
  const t = math.typeOf(v);
  switch (t) {
    case 'number':
    case 'BigNumber':
    case 'Fraction':
      return 'number';
    case 'Complex':
      return 'complex';
    case 'Matrix':
    case 'DenseMatrix':
    case 'SparseMatrix':
    case 'Array':
      return 'matrix';
    case 'Unit':
      return 'unit';
    case 'boolean':
      return 'boolean';
    case 'function':
      return 'function';
    case 'string':
      return 'string';
    default:
      return 'other';
  }
}

/** Prepare a raw user string for parsing (normalisation + braces). */
export function prepare(input: string): string {
  let s = normalizeInput(input);
  if (s.includes('{')) {
    const { expr, restrictions } = extractBraces(s);
    s = restrictions.length ? `(${restrictions.map((r) => `(${r})`).join(' and ')}) ? (${expr}) : NaN` : expr;
  }
  return verifyRewrite(s);
}

/**
 * Verify mode (like the Casio ClassWiz): "2+2 = 4" or "sin(30)^2 + cos(30)^2 = 1"
 * becomes an equality test. Assignments (a = 5, f(x) = …) are left alone.
 */
function verifyRewrite(s: string): string {
  // segment start (after "(", "[" or ",") for every nesting level
  const starts: number[] = [0];
  const swaps: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[' || c === '{') starts.push(i + 1);
    else if (c === ')' || c === ']' || c === '}') starts.pop();
    else if (c === ',' || c === ';') starts[starts.length - 1] = i + 1;
    else if (c === '=' && !'<>!='.includes(s[i - 1] ?? '') && s[i + 1] !== '=') {
      const lhs = s.slice(starts[starts.length - 1] ?? 0, i).trim();
      const assignable = /^[A-Za-z_]\w*(\s*\([^()]*\))?$/.test(lhs) || /^[A-Za-z_]\w*\s*\[.*\]$/.test(lhs);
      if (lhs && !assignable) swaps.push(i);
    }
  }
  if (!swaps.length) return s;
  let out = s;
  for (const i of swaps.reverse()) out = `${out.slice(0, i)}==${out.slice(i + 1)}`;
  return out;
}

export class Calculator {
  math: CalciMath;
  settings: CalculatorSettings;
  readonly scope = new Map<string, unknown>();
  private libraryNames = new Set<string>();

  constructor(settings: Partial<CalculatorSettings> = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.math = createMath(this.settings);
    this.scope.set('ans', 0);
    this.scope.set('M', 0);
  }

  /** Update settings. Recreates the math instance only when required. */
  configure(partial: Partial<CalculatorSettings>): void {
    const prev = this.settings;
    this.settings = { ...prev, ...partial };
    if (partial.bignumber !== undefined && partial.bignumber !== prev.bignumber || (partial.precision !== undefined && partial.precision !== prev.precision) || (partial.safe !== undefined && partial.safe !== prev.safe)) {
      this.math = createMath(this.settings);
      // re-type numeric values for the new number mode
      for (const [k, v] of this.scope) {
        const n = toNumber(v);
        if (typeof v === 'number' || (v as any)?.isBigNumber) this.scope.set(k, this.settings.bignumber ? this.math.bignumber(n) : n);
      }
    } else if (partial.angle) {
      this.math.calci.angle = partial.angle;
    }
  }

  setAngle(angle: AngleUnit) {
    this.configure({ angle });
  }

  get ans(): unknown {
    return this.scope.get('ans');
  }

  parse(input: string): MathNode {
    const node = parseWith(this.math, prepare(input));
    if (this.settings.safe) assertSafe(node);
    return node;
  }

  /** Evaluate and commit side effects (assignments, Ans). */
  evaluate(input: string, extra?: Record<string, number>): EvalResult {
    return this.run(input, true, extra);
  }

  /** Evaluate without side effects, for live previews. Returns null when not meaningful. */
  preview(input: string, extra?: Record<string, number>): EvalResult | null {
    if (!input.trim()) return null;
    if (/\b(rand|randInt|random|randomInt|pickRandom)\b/.test(input)) return null;
    const r = this.run(input, false, extra);
    return r.ok ? r : null;
  }

  /**
   * Names in an expression that are neither defined variables, constants,
   * functions nor units — candidates for "enter a value for x" prompts (Casio CALC).
   */
  unknownSymbols(input: string): string[] {
    try {
      const node = parseWith(this.math, prepare(input));
      const out = new Set<string>();
      const assigned = new Set<string>();
      node.traverse((n: any) => {
        if (n.type === 'FunctionAssignmentNode') n.params.forEach((p: string) => assigned.add(p));
        if (n.type === 'AssignmentNode' && n.object?.name) assigned.add(n.object.name);
      });
      node.traverse((n: any, _p: string, parent: any) => {
        if (n.type !== 'SymbolNode') return;
        if (parent?.type === 'FunctionNode' && parent.fn === n) return;
        const name: string = n.name;
        if (assigned.has(name) || this.scope.has(name) || name in this.math) return;
        if ((this.math as any).Unit?.isValuelessUnit?.(name)) return;
        if (['integral', 'diff', 'sigma', 'product', 'limit', 'nsolve'].some((f) => node.toString().includes(`${f}(`))) {
          // bound variables of calculus functions are not unknowns
          let bound = false;
          node.traverse((m: any) => {
            if (m.type === 'FunctionNode' && ['integral', 'nInt', 'diff', 'sigma', 'product', 'limit', 'nsolve', 'summation'].includes(m.fn?.name) && m.args[1]?.name === name) bound = true;
          });
          if (bound) return;
        }
        out.add(name);
      });
      return [...out];
    } catch {
      return [];
    }
  }

  private run(input: string, commit: boolean, extra?: Record<string, number>): EvalResult {
    const base: EvalResult = { ok: false, input, normalized: '', kind: 'empty', text: '', tex: '' };
    if (!input.trim()) return { ...base, ok: true };
    let normalized = '';
    try {
      normalized = prepare(input);
      if (this.settings.safe && normalized.length > 5000) throw new Error('Expression too long');
      const node = parseWith(this.math, normalized);
      if (this.settings.safe) assertSafe(node);
      resetBudget(this.math);
      let inputTex = '';
      try {
        inputTex = expressionTex(this.math, node);
      } catch {
        inputTex = '';
      }
      let scope: Map<string, unknown> = commit ? this.scope : new Map(this.scope);
      if (extra && Object.keys(extra).length) {
        const child = new ChildScope(scope);
        for (const [k, v] of Object.entries(extra)) child.set(k, this.settings.bignumber ? this.math.bignumber(v) : v);
        scope = child;
      }
      if (this.settings.safe) setWorkBudget(10_000_000);
      let value: unknown;
      try {
        value = node.compile().evaluate(scope);
      } finally {
        setWorkBudget(Infinity);
      }
      if (value && (value as any).isResultSet) {
        const entries = (value as any).entries as unknown[];
        value = entries[entries.length - 1];
      }
      const n = node as any;
      let assigned: string | undefined;
      if (n.type === 'AssignmentNode') assigned = n.name ?? n.object?.name;
      if (n.type === 'FunctionAssignmentNode') assigned = n.name;
      const kind = kindOf(this.math, value);
      if (commit && kind !== 'function' && kind !== 'empty' && value !== undefined) this.scope.set('ans', value);
      const f = formatValue(this.math, value, this.settings);
      let text = f.text;
      let tex = f.tex;
      if (kind === 'function' && n.type === 'FunctionAssignmentNode') {
        text = `${n.name}(${n.params.join(', ')}) defined`;
        tex = `\\text{${n.name}(${n.params.join(', ')}) defined}`;
      }
      const num = kind === 'number' && typeof value === 'number' ? value : NaN;
      return {
        ok: true,
        input,
        normalized,
        kind,
        text,
        tex,
        inputTex,
        value,
        assigned,
        exact: Number.isFinite(num) ? exactForm(num) : null,
      };
    } catch (e) {
      return { ...base, normalized, kind: 'error', error: friendlyError(e), text: friendlyError(e) };
    }
  }

  /** Format any value with the current display settings. */
  format(value: unknown) {
    return formatValue(this.math, value, this.settings);
  }

  /* ---------------------------------- memory ---------------------------------- */

  memoryAdd(sign: 1 | -1 = 1) {
    const cur = this.scope.get('M') ?? 0;
    const a = this.scope.get('ans') ?? 0;
    this.scope.set('M', sign > 0 ? this.math.add(cur as any, a as any) : this.math.subtract(cur as any, a as any));
  }
  memoryClear() {
    this.scope.set('M', 0);
  }
  memoryRecall(): unknown {
    return this.scope.get('M');
  }

  /* --------------------------------- variables --------------------------------- */

  variables(): Variable[] {
    const out: Variable[] = [];
    for (const [name, v] of this.scope) {
      if (name === 'ans' || this.libraryNames.has(name)) continue;
      const isFunction = typeof v === 'function';
      const f = isFunction ? { text: (v as any).syntax ?? name, tex: '' } : this.format(v);
      out.push({ name, text: f.text, tex: f.tex, isFunction });
    }
    return out;
  }

  setVariable(name: string, value: unknown) {
    this.scope.set(name, value);
  }

  deleteVariable(name: string) {
    if (name === 'ans' || name === 'M') this.scope.set(name, 0);
    else this.scope.delete(name);
  }

  clearVariables() {
    for (const k of [...this.scope.keys()]) if (!RESERVED.has(k) && !this.libraryNames.has(k)) this.scope.delete(k);
    this.scope.set('ans', 0);
  }

  /**
   * Load a user library: one definition per line, e.g. `f(x) = x^2 + 1` or
   * `g = 9.81`. Lines starting with # or // are comments. Returns per-line errors.
   */
  loadLibrary(source: string): { line: number; error: string }[] {
    for (const n of this.libraryNames) this.scope.delete(n);
    this.libraryNames.clear();
    const errors: { line: number; error: string }[] = [];
    source.split(/\r?\n/).forEach((raw, i) => {
      const line = raw.replace(/(#|\/\/).*$/, '').trim();
      if (!line) return;
      try {
        const node = parseWith(this.math, prepare(line)) as any;
        if (this.settings.safe) assertSafe(node);
        if (node.type !== 'AssignmentNode' && node.type !== 'FunctionAssignmentNode') throw new Error('Expected a definition such as f(x) = … or k = …');
        node.compile().evaluate(this.scope);
        this.libraryNames.add(node.name ?? node.object?.name);
      } catch (e) {
        errors.push({ line: i + 1, error: friendlyError(e) });
      }
    });
    return errors;
  }

  get libraryFunctionNames(): string[] {
    return [...this.libraryNames];
  }
}

/** Convenience one-shot evaluation (fresh, stateless calculator). */
export function evaluate(expr: string, settings: Partial<CalculatorSettings> = {}): EvalResult {
  return new Calculator(settings).evaluate(expr);
}
