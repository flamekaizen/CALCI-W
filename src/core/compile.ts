/**
 * Compiles a math.js expression tree into a fast native JavaScript function.
 *
 * Only a whitelisted subset of node types is accepted, identifiers are
 * validated, and literal numbers are serialised numerically, so the generated
 * source can never contain user-controlled code. Anything outside the subset
 * throws a CompileError and callers fall back to the math.js interpreter.
 */
import type { MathNode } from 'mathjs';
import * as N from './numerics.js';
import { distributions } from './distributions.js';

export type AngleUnit = 'rad' | 'deg' | 'grad';
export type NumFn = (...args: number[]) => number;

export class CompileError extends Error {
  constructor(message: string, public readonly symbol?: string) {
    super(message);
    this.name = 'CompileError';
  }
}

export interface CompileContext {
  /** Positional argument names, e.g. ['x'] or ['x', 'y']. */
  vars: string[];
  /** Numeric values available by name (sliders, scope variables). */
  constants?: Record<string, number>;
  /** User-defined functions callable by name. */
  functions?: Record<string, NumFn>;
  angle?: AngleUnit;
}

const IDENT = /^[A-Za-z_][A-Za-z_0-9]*$/;

const BUILTIN_CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  PI: Math.PI,
  e: Math.E,
  E: Math.E,
  tau: 2 * Math.PI,
  phi: (1 + Math.sqrt(5)) / 2,
  Infinity,
  NaN,
  true: 1,
  false: 0,
  LN2: Math.LN2,
  LN10: Math.LN10,
  LOG2E: Math.LOG2E,
  LOG10E: Math.LOG10E,
  SQRT2: Math.SQRT2,
  SQRT1_2: Math.SQRT1_2,
};

/** Real power with sign-preserving odd roots: (-8)^(1/3) = -2. */
function rpow(a: number, b: number): number {
  if (a >= 0 || Number.isInteger(b)) return Math.pow(a, b);
  // try to express b as p/q with q odd
  for (let q = 3; q <= 99; q += 2) {
    const p = Math.round(b * q);
    if (Math.abs(p / q - b) < 1e-12) {
      const r = Math.pow(-a, b);
      return p % 2 === 0 ? r : -r;
    }
  }
  return NaN;
}

function nCr(n: number, r: number): number {
  if (r < 0 || r > n) return 0;
  if (Number.isInteger(n) && Number.isInteger(r) && n < 1e6) {
    r = Math.min(r, n - r);
    let c = 1;
    for (let i = 1; i <= r; i++) c = (c * (n - r + i)) / i;
    return Math.round(c);
  }
  return Math.exp(N.lgamma(n + 1) - N.lgamma(r + 1) - N.lgamma(n - r + 1));
}

function nPr(n: number, r: number): number {
  if (r < 0 || r > n) return 0;
  let p = 1;
  if (Number.isInteger(n) && Number.isInteger(r)) {
    for (let i = 0; i < r; i++) p *= n - i;
    return p;
  }
  return N.gamma(n + 1) / N.gamma(n - r + 1);
}

/** math.js nearlyEqual (relTol 1e-12, absTol 1e-15). */
function nearly(a: number, b: number): boolean {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= Math.max(1e-12 * Math.max(Math.abs(a), Math.abs(b)), 1e-15);
}

function trigSnap(v: number, x: number): number {
  return Math.abs(v) < 1e-15 && Math.abs(x) > 1e-6 ? 0 : v;
}

/** Runtime helper library shared by all compiled functions for a given angle unit. */
export function makeRuntime(angle: AngleUnit = 'rad'): Record<string, NumFn> {
  const k = angle === 'deg' ? Math.PI / 180 : angle === 'grad' ? Math.PI / 200 : 1;
  const full = angle === 'deg' ? 360 : angle === 'grad' ? 400 : 0;
  const exactQuarter = (x: number): number => {
    if (!full) return -1;
    const r = ((x % full) + full) % full;
    const q = r / (full / 4);
    return Number.isInteger(q) ? q : -1;
  };
  const sin = (x: number) => {
    const q = exactQuarter(x);
    if (q >= 0) return [0, 1, 0, -1][q];
    return trigSnap(Math.sin(x * k), x * k);
  };
  const cos = (x: number) => {
    const q = exactQuarter(x);
    if (q >= 0) return [1, 0, -1, 0][q];
    return trigSnap(Math.cos(x * k), x * k);
  };
  const tan = (x: number) => {
    const q = exactQuarter(x);
    if (q >= 0) return [0, NaN, 0, NaN][q];
    const c = cos(x);
    return c === 0 ? NaN : trigSnap(Math.tan(x * k), x * k);
  };
  const inv = (v: number) => v / k;
  const R: Record<string, NumFn> = {
    sin,
    cos,
    tan,
    sec: (x) => {
      const c = cos(x);
      return c === 0 ? NaN : 1 / c;
    },
    csc: (x) => {
      const s = sin(x);
      return s === 0 ? NaN : 1 / s;
    },
    cot: (x) => {
      const s = sin(x);
      return s === 0 ? NaN : cos(x) / s;
    },
    asin: (x) => inv(Math.asin(x)),
    acos: (x) => inv(Math.acos(x)),
    atan: (x) => inv(Math.atan(x)),
    asec: (x) => inv(Math.acos(1 / x)),
    acsc: (x) => inv(Math.asin(1 / x)),
    acot: (x) => inv(x === 0 ? Math.PI / 2 : Math.atan(1 / x)),
    atan2: (y, x) => inv(Math.atan2(y, x)),
    sinh: Math.sinh,
    cosh: Math.cosh,
    tanh: Math.tanh,
    sech: (x) => 1 / Math.cosh(x),
    csch: (x) => 1 / Math.sinh(x),
    coth: (x) => 1 / Math.tanh(x),
    asinh: Math.asinh,
    acosh: Math.acosh,
    atanh: Math.atanh,
    asech: (x) => Math.acosh(1 / x),
    acsch: (x) => Math.asinh(1 / x),
    acoth: (x) => Math.atanh(1 / x),
    sqrt: Math.sqrt,
    cbrt: Math.cbrt,
    nthRoot: (x, n = 2) => rpow(x, 1 / n),
    root: (x, n = 2) => rpow(x, 1 / n),
    exp: Math.exp,
    expm1: Math.expm1,
    log1p: Math.log1p,
    ln: Math.log,
    log: (x, b) => (b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b)),
    log10: Math.log10,
    log2: Math.log2,
    abs: Math.abs,
    sign: Math.sign,
    sgn: Math.sign,
    floor: Math.floor,
    ceil: Math.ceil,
    round: (x, n = 0) => {
      // half away from zero, like math.js
      const p = Math.pow(10, n);
      return (Math.sign(x) * Math.round(Math.abs(x) * p)) / p;
    },
    fix: Math.trunc,
    trunc: Math.trunc,
    ipart: Math.trunc,
    fpart: (x) => x - Math.trunc(x),
    frac: (x) => x - Math.trunc(x),
    min: (...a) => Math.min(...a),
    max: (...a) => Math.max(...a),
    hypot: (...a) => Math.hypot(...a),
    mod: (a, b) => {
      if (b === 0) return a;
      const r = a % b;
      return r !== 0 && r < 0 !== b < 0 ? r + b : r;
    },
    pow: rpow,
    gamma: N.gamma,
    lgamma: N.lgamma,
    factorial: N.factorial,
    erf: N.erf,
    erfc: N.erfc,
    gcd: (...a) => a.reduce((p, q) => N.gcd(p, q)),
    lcm: (...a) => a.reduce((p, q) => (p === 0 || q === 0 ? 0 : Math.abs(p * q) / N.gcd(p, q))),
    // comparisons with math.js's relative tolerance (so 0.1 + 0.2 == 0.3)
    cmp_equal: (a, b) => (nearly(a, b) ? 1 : 0),
    cmp_unequal: (a, b) => (nearly(a, b) ? 0 : 1),
    cmp_smaller: (a, b) => (a < b && !nearly(a, b) ? 1 : 0),
    cmp_larger: (a, b) => (a > b && !nearly(a, b) ? 1 : 0),
    cmp_smallerEq: (a, b) => (a <= b || nearly(a, b) ? 1 : 0),
    cmp_largerEq: (a, b) => (a >= b || nearly(a, b) ? 1 : 0),
    nCr,
    nPr,
    combinations: nCr,
    permutations: nPr,
    random: () => Math.random(),
    mean: (...a) => a.reduce((s, v) => s + v, 0) / a.length,
    sum: (...a) => a.reduce((s, v) => s + v, 0),
    sinc: (x) => (x === 0 ? 1 : Math.sin(x) / x),
    deg2rad: (x) => (x * Math.PI) / 180,
    rad2deg: (x) => (x * 180) / Math.PI,
    heaviside: (x) => (x < 0 ? 0 : x > 0 ? 1 : 0.5),
    clamp: (x, a, b) => Math.min(Math.max(x, a), b),
    lerp: (a, b, t) => a + (b - a) * t,
  };
  for (const [name, fn] of Object.entries(distributions)) R[name] = fn as NumFn;
  for (const [name, fn] of Object.entries(CALC_RUNTIME)) R[name] = fn as NumFn;
  return R;
}

const runtimes = new Map<AngleUnit, Record<string, NumFn>>();
export function runtime(angle: AngleUnit = 'rad') {
  let r = runtimes.get(angle);
  if (!r) {
    r = makeRuntime(angle);
    runtimes.set(angle, r);
  }
  return r;
}

const OPS: Record<string, string> = {
  add: '+',
  subtract: '-',
  multiply: '*',
  divide: '/',
  dotMultiply: '*',
  dotDivide: '/',
};
const CMP: Record<string, string> = {
  smaller: '<',
  larger: '>',
  smallerEq: '<=',
  largerEq: '>=',
  equal: '===',
  unequal: '!==',
};

interface GenState {
  ctx: CompileContext;
  R: Record<string, NumFn>;
  usedFunctions: Set<string>;
  /** Compiled sub-functions (bodies of integral / sigma / … ) referenced as K[i]. */
  K: NumFn[];
}

/** Calculus functions with a bound variable: name → [helper, min args, max args]. */
const BOUND_FNS: Record<string, [string, number, number]> = {
  integral: ['__integral', 4, 4],
  nInt: ['__integral', 4, 4],
  fnInt: ['__integral', 4, 4],
  sigma: ['__sigma', 4, 4],
  summation: ['__sigma', 4, 4],
  product: ['__product', 4, 4],
  diff: ['__diff', 3, 4],
  nDeriv: ['__diff', 3, 4],
  limit: ['__limit', 3, 3],
};

/**
 * Work budget shared by nested calculus helpers. Untrusted evaluation (public
 * API, embeds) sets a finite budget so sums of sums can't run for hours.
 */
let workBudget = Infinity;
export function setWorkBudget(n: number) {
  workBudget = n;
}
function spend(n: number) {
  workBudget -= n;
  if (workBudget < 0) throw new Error('This calculation is too expensive to run here');
}
const counted = (f: NumFn): NumFn => (Number.isFinite(workBudget) ? (t: number) => (spend(1), f(t)) : f);

const CALC_RUNTIME: Record<string, (...a: any[]) => number> = {
  __integral: (f: NumFn, a: number, b: number) => N.integrate(counted(f), a, b, 1e-10, 30).value,
  __sigma: (f: NumFn, a: number, b: number) => (b - a > 5e6 && Number.isFinite(b) ? NaN : N.series(counted(f), a, b).value),
  __product: (f: NumFn, a: number, b: number) => N.product(counted(f), a, b),
  __diff: (f: NumFn, x: number, order = 1) => N.derivative(counted(f), x, order),
  __limit: (f: NumFn, a: number) => N.limit(counted(f), a).value,
};

function gen(node: MathNode, st: GenState): string {
  const n = node as any;
  switch (node.type) {
    case 'ConstantNode': {
      const v = typeof n.value === 'number' ? n.value : Number(n.value);
      if (typeof n.value === 'boolean') return n.value ? '1' : '0';
      if (Number.isNaN(v)) {
        if (typeof n.value === 'string') throw new CompileError('Strings are not supported here');
        return 'NaN';
      }
      return v === Infinity ? 'Infinity' : v === -Infinity ? '(-Infinity)' : `(${String(v)})`;
    }
    case 'SymbolNode': {
      const name: string = n.name;
      if (!IDENT.test(name)) throw new CompileError(`Invalid symbol ${name}`);
      const idx = st.ctx.vars.indexOf(name);
      if (idx >= 0) return `a${idx}`;
      if (st.ctx.constants && Object.prototype.hasOwnProperty.call(st.ctx.constants, name)) return `C[${JSON.stringify(name)}]`;
      if (Object.prototype.hasOwnProperty.call(BUILTIN_CONSTANTS, name)) return `(${BUILTIN_CONSTANTS[name]})`;
      throw new CompileError(`Undefined symbol ${name}`, name);
    }
    case 'ParenthesisNode':
      return `(${gen(n.content, st)})`;
    case 'OperatorNode': {
      const fn: string = n.fn;
      const args: MathNode[] = n.args;
      if (args.length === 1) {
        const a = gen(args[0], st);
        if (fn === 'unaryMinus') return `(-${a})`;
        if (fn === 'unaryPlus') return `(+${a})`;
        if (fn === 'factorial') return `R.factorial(${a})`;
        if (fn === 'not') return `(${a} ? 0 : 1)`;
        throw new CompileError(`Operator ${n.op} not supported in fast mode`);
      }
      if (args.length === 2) {
        const a = gen(args[0], st);
        const b = gen(args[1], st);
        if (OPS[fn]) return `(${a} ${OPS[fn]} ${b})`;
        if (fn === 'pow' || fn === 'dotPow') return `R.pow(${a}, ${b})`;
        if (fn === 'mod') return `R.mod(${a}, ${b})`;
        if (CMP[fn]) return `R.cmp_${fn}(${a}, ${b})`;
        if (fn === 'and') return `((${a} && ${b}) ? 1 : 0)`;
        if (fn === 'or') return `((${a} || ${b}) ? 1 : 0)`;
        if (fn === 'xor') return `((!${a} !== !${b}) ? 1 : 0)`;
      }
      if (OPS[fn] && args.length > 2) return `(${args.map((a) => gen(a, st)).join(` ${OPS[fn]} `)})`;
      throw new CompileError(`Operator ${n.op} not supported in fast mode`);
    }
    case 'RelationalNode': {
      const params: MathNode[] = n.params;
      const conds: string[] = n.conditionals;
      const parts: string[] = [];
      const vals = params.map((p) => gen(p, st));
      for (let i = 0; i < conds.length; i++) {
        if (!CMP[conds[i]]) throw new CompileError('Unsupported comparison');
        parts.push(`R.cmp_${conds[i]}(${vals[i]}, ${vals[i + 1]})`);
      }
      return `((${parts.join(' && ')}) ? 1 : 0)`;
    }
    case 'ConditionalNode': {
      const c = gen(n.condition, st);
      const t = gen(n.trueExpr, st);
      const f = gen(n.falseExpr, st);
      return `((${c}) ? (${t}) : (${f}))`;
    }
    case 'FunctionNode': {
      const name: string = n.fn?.name ?? n.name;
      if (!name || !IDENT.test(name)) throw new CompileError('Unsupported function call');
      const bound = BOUND_FNS[name];
      if (bound && !(st.ctx.functions && Object.prototype.hasOwnProperty.call(st.ctx.functions, name))) {
        const raw = n.args as MathNode[];
        if (raw.length < bound[1] || raw.length > bound[2]) throw new CompileError(`${name}: wrong number of arguments`);
        const v = raw[1] as any;
        if (v.type !== 'SymbolNode') throw new CompileError(`${name}: the second argument must be a variable name`);
        // body is a function of the outer variables plus the bound variable
        const body = compileNode(raw[0], { ...st.ctx, vars: [...st.ctx.vars.filter((x) => x !== v.name), v.name] });
        const outer = st.ctx.vars.filter((x) => x !== v.name).map((x) => `a${st.ctx.vars.indexOf(x)}`);
        const k = st.K.push(body) - 1;
        const rest = raw.slice(2).map((a) => gen(a, st)).join(', ');
        return `R.${bound[0]}((t) => K[${k}](${[...outer, 't'].join(', ')}), ${rest})`;
      }
      const args = (n.args as MathNode[]).map((a) => gen(a, st)).join(', ');
      if (st.ctx.functions && Object.prototype.hasOwnProperty.call(st.ctx.functions, name)) {
        st.usedFunctions.add(name);
        return `F[${JSON.stringify(name)}](${args})`;
      }
      if (Object.prototype.hasOwnProperty.call(st.R, name)) return `R[${JSON.stringify(name)}](${args})`;
      throw new CompileError(`Unknown function ${name}`, name);
    }
    default:
      throw new CompileError(`${node.type} is not supported in fast mode`);
  }
}

/** Compile a node to a native function of ctx.vars. Throws CompileError. */
export function compileNode(node: MathNode, ctx: CompileContext): NumFn {
  const st: GenState = { ctx, R: runtime(ctx.angle ?? 'rad'), usedFunctions: new Set(), K: [] };
  const body = gen(node, st);
  const params = ctx.vars.map((_, i) => `a${i}`).join(', ');
  // eslint-disable-next-line no-new-func
  const factory = new Function('R', 'C', 'F', 'K', `"use strict"; return function(${params}) { return +(${body}); };`);
  return factory(st.R, ctx.constants ?? {}, ctx.functions ?? {}, st.K) as NumFn;
}

/** Collect free symbol names (excluding function names) used by a node. */
export function freeSymbols(node: MathNode): Set<string> {
  const out = new Set<string>();
  node.traverse((n: any, _path: string, parent: any) => {
    if (n.type === 'SymbolNode') {
      if (parent && parent.type === 'FunctionNode' && parent.fn === n) return;
      out.add(n.name);
    }
  });
  return out;
}

export function functionNames(node: MathNode): Set<string> {
  const out = new Set<string>();
  node.traverse((n: any) => {
    if (n.type === 'FunctionNode' && n.fn?.name) out.add(n.fn.name);
  });
  return out;
}

export const isBuiltinConstant = (name: string) => Object.prototype.hasOwnProperty.call(BUILTIN_CONSTANTS, name);
export const isRuntimeFunction = (name: string) => Object.prototype.hasOwnProperty.call(runtime('rad'), name);
