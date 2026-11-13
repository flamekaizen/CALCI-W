/**
 * Calculus toolkit: symbolic derivatives (with calculator log conventions),
 * Taylor polynomials, tangent lines, plus numeric integral / limit / series
 * helpers that work on expression strings.
 */
import { create, all, type MathNode, type MathJsInstance } from 'mathjs';
import { createMath, type CalciMath, type AngleUnit } from './math.js';
import { prepare } from './engine.js';
import { compileNode, CompileError, type NumFn } from './compile.js';
import { expressionTex, toFraction } from './format.js';
import * as N from './numerics.js';

/** Pristine math.js for symbolic work: its constant folding must use natural log. */
let symbolic: MathJsInstance | null = null;
const getMath = () => (symbolic ??= create(all)) as unknown as CalciMath;
/** Calculator-semantics instance for numeric evaluation of results. */
let calc: CalciMath | null = null;
const getCalc = () => (calc ??= createMath());

/**
 * Calculator convention is log = log10, ln = natural log. math.js symbolic
 * routines use log = natural log, so we translate around them.
 */
function toMathjsLogs(math: CalciMath, node: MathNode): MathNode {
  return node.transform((n: any) => {
    if (n.type === 'FunctionNode' && n.fn?.name === 'ln') return new (math as any).FunctionNode('log', n.args);
    if (n.type === 'FunctionNode' && n.fn?.name === 'log' && n.args.length === 1)
      return new (math as any).FunctionNode('log', [n.args[0], new (math as any).ConstantNode(10)]);
    return n;
  });
}
function fromMathjsLogs(math: CalciMath, node: MathNode): MathNode {
  return node.transform((n: any) => {
    if (n.type === 'FunctionNode' && n.fn?.name === 'log' && n.args.length === 1) return new (math as any).FunctionNode('ln', n.args);
    if (n.type === 'FunctionNode' && n.fn?.name === 'log' && n.args.length === 2) {
      const b = n.args[1];
      if (b.type === 'ConstantNode' && b.value === 10) return new (math as any).FunctionNode('log', [n.args[0]]);
    }
    return n;
  });
}

export interface SymbolicResult {
  text: string;
  tex: string;
  node: MathNode;
}

function simplifySafe(math: CalciMath, node: MathNode): MathNode {
  try {
    return math.simplify(node);
  } catch {
    return node;
  }
}

const MAX_SYMBOLIC_SIZE = 6000;
function nodeSize(node: MathNode): number {
  let n = 0;
  node.traverse(() => {
    n++;
  });
  return n;
}

/** Symbolic derivative of expr with respect to variable (order >= 1). */
export function differentiate(expr: string, variable = 'x', order = 1): SymbolicResult {
  const math = getMath();
  let node = toMathjsLogs(math, math.parse(prepare(expr)));
  for (let i = 0; i < order; i++) {
    node = math.derivative(node, variable);
    // keep repeated derivatives from growing exponentially
    if (i < order - 1 && nodeSize(node) > 400) node = simplifySafe(math, node);
    if (nodeSize(node) > MAX_SYMBOLIC_SIZE) throw new Error('The derivative is too large to display symbolically — use the numeric value instead');
  }
  node = fromMathjsLogs(math, simplifySafe(math, toMathjsLogs(math, fromMathjsLogs(math, node))));
  node = fromMathjsLogs(math, node);
  return { node, text: node.toString({ implicit: 'hide', parenthesis: 'auto' }), tex: expressionTex(getCalc(), node) };
}

/** Simplify an expression symbolically. */
export function simplify(expr: string): SymbolicResult {
  const math = getMath();
  const node = fromMathjsLogs(math, simplifySafe(math, toMathjsLogs(math, math.parse(prepare(expr)))));
  return { node, text: node.toString({ implicit: 'hide' }), tex: expressionTex(getCalc(), node) };
}

/** Expand / rationalise a polynomial-like expression. */
export function expand(expr: string): SymbolicResult {
  const math = getMath();
  let node: MathNode;
  try {
    node = math.rationalize(toMathjsLogs(math, math.parse(prepare(expr)))) as MathNode;
  } catch {
    node = simplifySafe(math, toMathjsLogs(math, math.parse(prepare(expr))));
  }
  node = fromMathjsLogs(math, node);
  return { node, text: node.toString({ implicit: 'hide' }), tex: expressionTex(getCalc(), node) };
}

/** Compile a one-variable expression string into a fast numeric function. */
export function fn1(expr: string, variable = 'x', angle: AngleUnit = 'rad', scope?: Record<string, number>): NumFn {
  const math = getMath();
  const node = math.parse(prepare(expr));
  try {
    return compileNode(node, { vars: [variable], constants: scope, angle });
  } catch (e) {
    if (!(e instanceof CompileError)) throw e;
    const m = createMath({ angle });
    const code = m.parse(prepare(expr)).compile();
    return (x: number) => {
      const v = code.evaluate({ ...scope, [variable]: x });
      return typeof v === 'number' ? v : Number(v?.toString?.() ?? NaN);
    };
  }
}

function coeffText(c: number): { text: string; tex: string } {
  const fr = toFraction(c, 100000, 1e-11);
  if (fr && fr[1] !== 1) return { text: `${fr[0]}/${fr[1]}`, tex: `\\frac{${fr[0]}}{${fr[1]}}` };
  const v = fr ? fr[0] : N.clean(c, 10);
  return { text: String(v), tex: String(v) };
}

export interface TaylorResult {
  coefficients: number[];
  text: string;
  tex: string;
}

/** Taylor polynomial of expr around a, up to the given order. */
export function taylor(expr: string, variable = 'x', a = 0, order = 5): TaylorResult {
  const math = getMath();
  let node = toMathjsLogs(math, math.parse(prepare(expr)));
  const coefficients: number[] = [];
  let fact = 1;
  let symbolic = true;
  for (let k = 0; k <= order; k++) {
    if (k > 0) {
      fact *= k;
      if (symbolic) {
        node = math.derivative(node, variable);
        if (nodeSize(node) > 400) node = simplifySafe(math, node);
        if (nodeSize(node) > MAX_SYMBOLIC_SIZE) symbolic = false;
      }
    }
    let v = NaN;
    if (symbolic) {
      try {
        const fnode = fromMathjsLogs(math, node);
        v = Number(getCalc().evaluate(fnode.toString(), { [variable]: a }));
      } catch {
        v = NaN;
      }
    }
    if (!Number.isFinite(v)) {
      // numeric fallback
      const f = fn1(expr, variable);
      v = N.derivative(f, a, k);
    }
    coefficients.push(N.clean(v / fact, 12));
  }
  const xa = a === 0 ? variable : `(${variable} ${a < 0 ? '+' : '-'} ${Math.abs(a)})`;
  const xaTex = a === 0 ? variable : `\\left(${variable} ${a < 0 ? '+' : '-'} ${Math.abs(a)}\\right)`;
  const parts: string[] = [];
  const texParts: string[] = [];
  coefficients.forEach((c, k) => {
    if (c === 0) return;
    const { text, tex } = coeffText(Math.abs(c));
    const sign = c < 0 ? '-' : '+';
    const pw = k === 0 ? '' : k === 1 ? xa : `${xa}^${k}`;
    const pwTex = k === 0 ? '' : k === 1 ? xaTex : `${xaTex}^{${k}}`;
    const coef = k > 0 && text === '1' ? '' : text;
    const coefTex = k > 0 && tex === '1' ? '' : tex;
    parts.push(`${sign} ${coef}${coef && pw ? '*' : ''}${pw}`);
    texParts.push(`${sign} ${coefTex}${pwTex}`);
  });
  const join = (p: string[]) => (p.length ? p.join(' ').replace(/^\+ /, '').replace(/^- /, '-') : '0');
  return { coefficients, text: join(parts), tex: join(texParts) };
}

export interface TangentResult {
  slope: number;
  intercept: number;
  y0: number;
  text: string;
}

export function tangentLine(expr: string, at: number, variable = 'x'): TangentResult {
  const f = fn1(expr, variable);
  const y0 = f(at);
  const slope = N.clean(N.derivative(f, at), 12);
  const intercept = N.clean(y0 - slope * at, 12);
  const b = intercept === 0 ? '' : ` ${intercept < 0 ? '-' : '+'} ${Math.abs(intercept)}`;
  return { slope, intercept, y0, text: `y = ${slope}${variable}${b}` };
}

export function definiteIntegral(expr: string, a: number, b: number, variable = 'x', angle: AngleUnit = 'rad') {
  const f = fn1(expr, variable, angle);
  const r = N.integrate(f, a, b);
  return { ...r, value: N.clean(r.value, 13) };
}

export function limitOf(expr: string, a: number, variable = 'x', side: 'both' | 'left' | 'right' = 'both') {
  return N.limit(fn1(expr, variable), a, side);
}

export function sumSeries(expr: string, from: number, to: number, variable = 'n') {
  return N.series(fn1(expr, variable), from, to);
}

export function derivativeAt(expr: string, at: number, variable = 'x', order = 1) {
  return N.clean(N.derivative(fn1(expr, variable), at, order), order > 1 ? 8 : 11);
}
