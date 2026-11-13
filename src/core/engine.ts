/**
 * Stateful calculator engine: variables, Ans, memory, user library, history.
 * Framework-free; used by the web UI, the desktop/mobile apps, the SDK and the API.
 */
import type { MathNode } from 'mathjs';
import { createMath, assertSafe, toNumber, parseWith, resetBudget, type CalciMath, type MathConfig, type AngleUnit } from './math.js';
import { normalizeInput, extractBraces } from './normalize.js';
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
  return s;
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
  evaluate(input: string): EvalResult {
    return this.run(input, true);
  }

  /** Evaluate without side effects, for live previews. Returns null when not meaningful. */
  preview(input: string): EvalResult | null {
    if (!input.trim()) return null;
    if (/\b(rand|randInt|random|randomInt|pickRandom)\b/.test(input)) return null;
    const r = this.run(input, false);
    return r.ok ? r : null;
  }

  private run(input: string, commit: boolean): EvalResult {
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
      const scope = commit ? this.scope : new Map(this.scope);
      let value = node.compile().evaluate(scope);
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
