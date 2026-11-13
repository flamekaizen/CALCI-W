/**
 * Turns a list of graph expression lines into compiled, plottable items.
 * Supports: y = f(x), x = g(y), r = f(theta), parametric (x(t), y(t)),
 * implicit equations F(x, y) = G(x, y), inequalities, points, sliders
 * (a = 3), user functions (f(x) = ...), domain restrictions {…} and
 * piecewise definitions {cond: value, …}.
 */
import { parse as mparse, type MathNode } from 'mathjs';
import { normalizeInput, extractBraces, splitTopLevel, matchBracket } from '../normalize.js';
import { compileNode, CompileError, freeSymbols, isBuiltinConstant, isRuntimeFunction, runtime, type NumFn, type AngleUnit } from '../compile.js';
import { create, all } from 'mathjs';

export type GraphKind =
  | 'empty' | 'explicit' | 'explicitX' | 'polar' | 'parametric' | 'implicit'
  | 'inequality' | 'points' | 'variable' | 'function' | 'value' | 'error';

export type IneqOp = '<' | '<=' | '>' | '>=';

export interface GraphLine {
  id: string;
  text: string;
  /** Parameter range for parametric / polar curves. */
  range?: [number, number];
}

export interface CompiledItem {
  id: string;
  kind: GraphKind;
  /** explicit: y(x); explicitX: x(y); polar: r(theta); implicit / inequality: F(x, y) = lhs - rhs */
  fn?: NumFn;
  fx?: NumFn;
  fy?: NumFn;
  /** Optional restriction predicate (x, y, t) → 1 / 0 */
  restrict?: NumFn;
  op?: IneqOp;
  /** For inequalities solved for y or x: which side is shaded */
  ineqAxis?: 'y' | 'x' | null;
  /** Compiled condition for chained inequalities */
  cond?: NumFn;
  points?: [number, number][];
  name?: string;
  params?: string[];
  value?: number;
  range?: [number, number];
  error?: string;
  /** Undefined single-letter symbols: candidates for "add slider". */
  missing?: string[];
  /** Expression source for derivative / analysis */
  node?: MathNode;
}

const RESERVED_VARS = new Set(['x', 'y', 'r', 'theta', 't']);
const KNOWN_MULTI = ['theta', 'pi', 'tau', 'phi'];

/** Split "xy" / "ax" / "pix" into a product of known symbols when possible. */
function splitSymbol(name: string, known: Set<string>): string[] | null {
  if (known.has(name) || isBuiltinConstant(name)) return null;
  const memo = new Map<number, string[] | null>();
  const go = (i: number): string[] | null => {
    if (i === name.length) return [];
    if (memo.has(i)) return memo.get(i)!;
    let res: string[] | null = null;
    for (const m of KNOWN_MULTI) {
      if (name.startsWith(m, i) && (known.has(m) || isBuiltinConstant(m))) {
        const rest = go(i + m.length);
        if (rest) {
          res = [m, ...rest];
          break;
        }
      }
    }
    if (!res) {
      const c = name[i];
      if (known.has(c) || isBuiltinConstant(c)) {
        const rest = go(i + 1);
        if (rest) res = [c, ...rest];
      }
    }
    memo.set(i, res);
    return res;
  };
  const parts = go(0);
  return parts && parts.length > 1 ? parts : null;
}

const m = create(all);

function implicitSplit(node: MathNode, known: Set<string>, fnNames: Set<string>): MathNode {
  return node.transform((n: any, _p: string, parent: any) => {
    if (n.type === 'SymbolNode' && !(parent?.type === 'FunctionNode' && parent.fn === n)) {
      if (fnNames.has(n.name)) return n;
      const parts = splitSymbol(n.name, known);
      if (parts) {
        const syms = parts.map((p) => new (m as any).SymbolNode(p));
        return syms.reduce((a: any, b: any) => new (m as any).OperatorNode('*', 'multiply', [a, b], true));
      }
    }
    if (n.type === 'FunctionNode' && n.fn?.name && !fnNames.has(n.fn.name) && !isRuntimeFunction(n.fn.name)) {
      // "a(x+1)" where a is a slider → a * (x+1)
      if (known.has(n.fn.name)) {
        const arg = n.args.length === 1 ? n.args[0] : null;
        if (arg) return new (m as any).OperatorNode('*', 'multiply', [new (m as any).SymbolNode(n.fn.name), new (m as any).ParenthesisNode(arg)], true);
      }
    }
    return n;
  });
}

/** Find the top-level comparison/equality operator of a line. */
function splitRelation(s: string): { lhs: string; op: '=' | IneqOp; rhs: string; chained: boolean } | null {
  let depth = 0;
  const found: { i: number; op: string }[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0) {
      const two = s.slice(i, i + 2);
      if (two === '<=' || two === '>=' || two === '==' || two === '!=') {
        found.push({ i, op: two });
        i++;
      } else if (c === '<' || c === '>' || c === '=') found.push({ i, op: c });
    }
  }
  if (!found.length) return null;
  if (found.length > 1) return { lhs: s, op: found[0].op as IneqOp, rhs: '', chained: true };
  const f = found[0];
  const op = f.op === '==' ? '=' : (f.op as '=' | IneqOp);
  if (op === ('!=' as string)) return null;
  return { lhs: s.slice(0, f.i).trim(), op, rhs: s.slice(f.i + f.op.length).trim(), chained: false };
}

function parseNode(src: string): MathNode {
  return mparse(src);
}

function flipOp(op: IneqOp): IneqOp {
  return op === '<' ? '>' : op === '>' ? '<' : op === '<=' ? '>=' : '<=';
}

interface Def {
  line: GraphLine;
  kind: 'variable' | 'function';
  name: string;
  params?: string[];
  body: MathNode;
}

export interface CompileOptions {
  angle?: AngleUnit;
  /** Extra user-library functions available everywhere, e.g. ["f(x) = x^2"]. */
  library?: string[];
}

export interface CompiledGraph {
  items: CompiledItem[];
  constants: Record<string, number>;
  functions: Record<string, NumFn>;
}

const isPointList = (s: string) => {
  const t = s.trim();
  if (!t.startsWith('(')) return false;
  const close = matchBracket(t, 0);
  if (close < 0) return false;
  const inner = t.slice(1, close);
  return splitTopLevel(inner, ',').length === 2;
};

export function compileGraph(lines: GraphLine[], opts: CompileOptions = {}): CompiledGraph {
  const angle = opts.angle ?? 'rad';
  const constants: Record<string, number> = {};
  const functions: Record<string, NumFn> = {};
  const items = new Map<string, CompiledItem>();
  const defs: Def[] = [];
  const pre = new Map<string, { expr: string; restrictions: string[] }>();

  const allLines: GraphLine[] = [...(opts.library ?? []).map((text, i) => ({ id: `__lib${i}`, text })), ...lines];

  // pass 1: normalise, find definitions
  for (const line of allLines) {
    const raw = line.text.trim();
    if (!raw) {
      items.set(line.id, { id: line.id, kind: 'empty' });
      continue;
    }
    let norm: string;
    try {
      norm = normalizeInput(raw);
    } catch (e) {
      items.set(line.id, { id: line.id, kind: 'error', error: String(e) });
      continue;
    }
    const br = extractBraces(norm);
    pre.set(line.id, br);
    const rel = splitRelation(br.expr);
    if (rel && rel.op === '=' && !rel.chained) {
      const fm = rel.lhs.match(/^([A-Za-z_]\w*)\s*\(\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*\)$/);
      if (fm && !['x', 'y', 'r'].includes(fm[1])) {
        try {
          defs.push({ line, kind: 'function', name: fm[1], params: fm[2].split(',').map((p) => p.trim()), body: parseNode(rel.rhs) });
        } catch (e) {
          items.set(line.id, { id: line.id, kind: 'error', error: (e as Error).message });
        }
        continue;
      }
      const vm = rel.lhs.match(/^([A-Za-z_]\w*)$/);
      // 'xy = 1' is an implicit curve (x*y), not a variable named xy
      const looksLikeProduct = !!vm && vm[1].length > 1 && /^[A-Za-z]+$/.test(vm[1]) && /[xy]/.test(vm[1]) && !KNOWN_MULTI.includes(vm[1]);
      if (vm && !RESERVED_VARS.has(vm[1]) && !looksLikeProduct) {
        try {
          defs.push({ line, kind: 'variable', name: vm[1], body: parseNode(rel.rhs) });
        } catch (e) {
          items.set(line.id, { id: line.id, kind: 'error', error: (e as Error).message });
        }
        continue;
      }
    }
  }

  const fnNames = new Set(defs.filter((d) => d.kind === 'function').map((d) => d.name));
  const varNames = new Set(defs.filter((d) => d.kind === 'variable').map((d) => d.name));
  const knownBase = new Set<string>([...varNames, 'x', 'y', 't', 'theta', 'r', 'e', 'pi', 'tau', 'phi']);

  // pass 2: resolve variables iteratively (they may depend on each other / on functions)
  const pending = defs.filter((d) => d.kind === 'variable');
  const fnDefs = defs.filter((d) => d.kind === 'function');
  // functions first (lazy, they read constants by reference at call time).
  // Pre-declare slider names so function bodies may reference them.
  for (const v of varNames) constants[v] = NaN;
  const resolved = new Set<string>();
  for (const d of fnDefs) {
    const known = new Set([...knownBase, ...d.params!]);
    const body = implicitSplit(d.body, known, fnNames);
    try {
      functions[d.name] = compileNode(body, { vars: d.params!, constants, functions, angle });
      items.set(d.line.id, { id: d.line.id, kind: 'function', name: d.name, params: d.params, node: body });
    } catch (e) {
      const sym = e instanceof CompileError ? e.symbol : undefined;
      items.set(d.line.id, {
        id: d.line.id,
        kind: 'error',
        error: (e as Error).message,
        missing: sym && sym.length <= 2 && !fnNames.has(sym) ? [sym] : undefined,
      });
    }
  }
  let progress = true;
  const unresolved = new Map<string, Error>();
  while (pending.length && progress) {
    progress = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const d = pending[i];
      const body = implicitSplit(d.body, knownBase, fnNames);
      const syms = [...freeSymbols(body)].filter((s) => !isBuiltinConstant(s));
      if (syms.some((s) => varNames.has(s) && !resolved.has(s) && s !== d.name)) continue;
      try {
        const f = compileNode(body, { vars: [], constants, functions, angle });
        const v = f();
        constants[d.name] = v;
        resolved.add(d.name);
        items.set(d.line.id, { id: d.line.id, kind: 'variable', name: d.name, value: v, node: body });
        pending.splice(i, 1);
        progress = true;
      } catch (e) {
        unresolved.set(d.line.id, e as Error);
        pending.splice(i, 1);
        const sym = e instanceof CompileError ? e.symbol : undefined;
        const msg = sym && RESERVED_VARS.has(sym) ? `${d.name} can't depend on ${sym}. Write ${d.name}(${sym}) = … to define a function.` : (e as Error).message;
        items.set(d.line.id, { id: d.line.id, kind: 'error', error: msg, missing: sym && !RESERVED_VARS.has(sym) && sym.length <= 2 ? [sym] : undefined });
        progress = true;
      }
    }
  }
  for (const d of pending) items.set(d.line.id, { id: d.line.id, kind: 'error', error: 'Circular definition' });

  const known = new Set([...knownBase, ...Object.keys(constants)]);
  const compile = (node: MathNode, vars: string[]) => compileNode(implicitSplit(node, new Set([...known, ...vars]), fnNames), { vars, constants, functions, angle });

  const missingFrom = (e: unknown): string[] | undefined => {
    if (e instanceof CompileError && e.symbol && !RESERVED_VARS.has(e.symbol) && /^[A-Za-z](_?\w)?$/.test(e.symbol)) return [e.symbol];
    return undefined;
  };

  // pass 3: plottable lines
  for (const line of allLines) {
    if (items.has(line.id)) continue;
    const br = pre.get(line.id);
    if (!br) continue;
    const it: CompiledItem = { id: line.id, kind: 'error' };
    try {
      let restrict: NumFn | undefined;
      if (br.restrictions.length) {
        const rn = parseNode(br.restrictions.map((r) => `(${r})`).join(' and '));
        restrict = compile(rn, ['x', 'y', 't', 'theta']);
      }
      it.restrict = restrict;
      const expr = br.expr.trim();
      const rel = splitRelation(expr);

      if (!rel) {
        if (isPointList(expr)) {
          // points or parametric
          const groups: string[] = [];
          let s = expr;
          while (s.trim().startsWith('(')) {
            s = s.trim();
            const close = matchBracket(s, 0);
            if (close < 0) throw new Error('Unbalanced parentheses');
            groups.push(s.slice(1, close));
            s = s.slice(close + 1).trim().replace(/^,/, '');
          }
          if (s.trim()) throw new Error('Unexpected text after point');
          const parsed = groups.map((g) => splitTopLevel(g, ',').map((p) => implicitSplit(parseNode(p), new Set([...known, 't']), fnNames)));
          const usesT = parsed.some((pair) => pair.some((p) => freeSymbols(p).has('t')));
          if (usesT && parsed.length === 1) {
            it.kind = 'parametric';
            it.fx = compile(parsed[0][0], ['t']);
            it.fy = compile(parsed[0][1], ['t']);
            it.range = line.range ?? [0, 2 * Math.PI];
          } else {
            it.kind = 'points';
            it.points = parsed.map(([a, b]) => [compile(a, [])(), compile(b, [])()]);
          }
        } else {
          const node = parseNode(expr);
          const syms = freeSymbols(implicitSplit(node, known, fnNames));
          if (syms.has('y') && syms.has('x')) {
            it.kind = 'implicit';
            it.fn = compile(node, ['x', 'y']);
          } else if (syms.has('x')) {
            it.kind = 'explicit';
            it.fn = compile(node, ['x']);
            it.node = node;
          } else if (syms.has('theta')) {
            it.kind = 'polar';
            it.fn = compile(node, ['theta']);
            it.range = line.range ?? [0, angle === 'deg' ? 360 : angle === 'grad' ? 400 : 2 * Math.PI];
          } else if (syms.has('y')) {
            it.kind = 'explicitX';
            // treat bare g(y) as x = g(y)
            it.fn = compile(node, ['y']);
          } else {
            it.kind = 'value';
            it.value = compile(node, [])();
          }
        }
      } else if (rel.chained) {
        // e.g. -1 < y < x^2 : region where the condition holds
        const node = parseNode(expr);
        it.kind = 'inequality';
        it.cond = compile(node, ['x', 'y']);
        it.ineqAxis = null;
      } else {
        const lhsNode = parseNode(rel.lhs);
        const rhsNode = parseNode(rel.rhs);
        const lhsS = rel.lhs.replace(/\s+/g, '');
        const rhsS = rel.rhs.replace(/\s+/g, '');
        const rhsSyms = freeSymbols(implicitSplit(rhsNode, known, fnNames));
        const lhsSyms = freeSymbols(implicitSplit(lhsNode, known, fnNames));
        if (rel.op === '=') {
          if (lhsS === 'y' && !rhsSyms.has('y')) {
            it.kind = 'explicit';
            it.fn = compile(rhsNode, ['x']);
            it.node = rhsNode;
          } else if (rhsS === 'y' && !lhsSyms.has('y')) {
            it.kind = 'explicit';
            it.fn = compile(lhsNode, ['x']);
            it.node = lhsNode;
          } else if (lhsS === 'x' && !rhsSyms.has('x')) {
            it.kind = 'explicitX';
            it.fn = compile(rhsNode, ['y']);
          } else if (lhsS === 'r' && !rhsSyms.has('r')) {
            it.kind = 'polar';
            it.fn = compile(rhsNode, ['theta']);
            it.range = line.range ?? [0, angle === 'deg' ? 360 : angle === 'grad' ? 400 : 2 * Math.PI];
          } else {
            it.kind = 'implicit';
            const diff = new (m as any).OperatorNode('-', 'subtract', [lhsNode, new (m as any).ParenthesisNode(rhsNode)]);
            const usesR = lhsSyms.has('r') || rhsSyms.has('r') || lhsSyms.has('theta') || rhsSyms.has('theta');
            if (usesR) {
              const g = compile(diff, ['r', 'theta']);
              const toUser = angle === 'deg' ? 180 / Math.PI : angle === 'grad' ? 200 / Math.PI : 1;
              it.fn = (x: number, y: number) => g(Math.hypot(x, y), Math.atan2(y, x) * toUser);
            } else it.fn = compile(diff, ['x', 'y']);
          }
        } else {
          it.kind = 'inequality';
          it.op = rel.op;
          const diff = new (m as any).OperatorNode('-', 'subtract', [lhsNode, new (m as any).ParenthesisNode(rhsNode)]);
          if (lhsS === 'y' && !rhsSyms.has('y')) {
            it.ineqAxis = 'y';
            it.fn = compile(rhsNode, ['x']);
          } else if (rhsS === 'y' && !lhsSyms.has('y')) {
            it.ineqAxis = 'y';
            it.op = flipOp(rel.op);
            it.fn = compile(lhsNode, ['x']);
          } else if (lhsS === 'x' && !rhsSyms.has('x')) {
            it.ineqAxis = 'x';
            it.fn = compile(rhsNode, ['y']);
          } else if (rhsS === 'x' && !lhsSyms.has('x')) {
            it.ineqAxis = 'x';
            it.op = flipOp(rel.op);
            it.fn = compile(lhsNode, ['y']);
          } else {
            it.ineqAxis = null;
            it.fn = compile(diff, ['x', 'y']);
          }
        }
      }
    } catch (e) {
      it.kind = 'error';
      it.error = (e as Error).message.replace(/\s*\(char \d+\)$/, '');
      it.missing = missingFrom(e);
    }
    items.set(line.id, it);
  }

  return {
    items: lines.map((l) => items.get(l.id) ?? { id: l.id, kind: 'empty' as const }),
    constants,
    functions,
  };
}

/** Evaluate a scalar expression with the graph's constants & functions. */
export function evalWith(expr: string, g: Pick<CompiledGraph, 'constants' | 'functions'>, angle: AngleUnit = 'rad'): number {
  const node = mparse(normalizeInput(expr));
  return compileNode(node, { vars: [], constants: g.constants, functions: g.functions, angle })();
}

export { runtime };
