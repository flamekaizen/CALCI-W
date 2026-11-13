/**
 * A configured math.js instance with calculator semantics:
 *  - angle-aware trigonometry (rad / deg / grad) with exact quarter turns
 *  - log(x) = log10, ln(x) = natural log, log(x, b) = log base b
 *  - calculator extras (nCr, nPr, root, primeFactors, ipart, fpart, ...)
 *  - in-expression calculus: integral, diff, sigma, product, limit, nsolve
 *  - optional "safe" mode for untrusted input (public API, shared links)
 */
import { create, all, type MathJsInstance, type MathNode } from 'mathjs';
import * as N from './numerics.js';
import { compileNode, CompileError, type AngleUnit, type NumFn } from './compile.js';
import { distributions } from './distributions.js';

export type { AngleUnit };

export interface MathConfig {
  angle: AngleUnit;
  /** Arbitrary precision arithmetic (BigNumber). */
  bignumber: boolean;
  /** Significant digits used in BigNumber mode. */
  precision: number;
  /** Harden against untrusted input. */
  safe: boolean;
}

export type CalciMath = MathJsInstance & { calci: MathConfig };

export const DEFAULT_MATH_CONFIG: MathConfig = { angle: 'rad', bignumber: false, precision: 64, safe: false };

/** Function names that must never be callable from untrusted expressions. */
export const UNSAFE_FUNCTIONS = new Set([
  'import', 'createUnit', 'evaluate', 'parse', 'compile', 'parser', 'simplify', 'simplifyConstant', 'simplifyCore',
  'derivative', 'resolve', 'reviver', 'replacer', 'chain', 'config', 'typed', 'help', 'rationalize', 'leafCount',
  'symbolicEqual',
]);

/** Functions replaced by throwing stubs inside safe instances (typed/config must stay intact for math.js internals). */
const STUBBED_FUNCTIONS = [...UNSAFE_FUNCTIONS].filter((n) => n !== 'typed' && n !== 'config');

/** Child scope that reads through to its parent but writes locally. */
export class ChildScope extends Map<string, unknown> {
  constructor(private readonly parent: { get(k: string): unknown; has(k: string): boolean; keys?(): IterableIterator<string> } | undefined) {
    super();
  }
  override get(k: string): unknown {
    return super.has(k) ? super.get(k) : this.parent?.get(k);
  }
  override has(k: string): boolean {
    return super.has(k) || (this.parent?.has(k) ?? false);
  }
}

export function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v && typeof v === 'object') {
    const o = v as any;
    if (o.isBigNumber) return o.toNumber();
    if (o.isFraction) return o.valueOf();
    if (o.isComplex) return Math.abs(o.im) < 1e-12 * Math.max(1, Math.abs(o.re)) ? o.re : NaN;
    if (o.isUnit && o.value != null && o.dimensions?.every((d: number) => d === 0)) return o.value;
  }
  return NaN;
}

/** Collect numeric constants and callable functions from a math.js scope. */
export function scopeToContext(scope: any): { constants: Record<string, number>; functions: Record<string, NumFn> } {
  const constants: Record<string, number> = {};
  const functions: Record<string, NumFn> = {};
  if (!scope) return { constants, functions };
  const keys: Iterable<string> = typeof scope.keys === 'function' ? scope.keys() : Object.keys(scope);
  for (const k of keys) {
    const v = typeof scope.get === 'function' ? scope.get(k) : scope[k];
    if (typeof v === 'function') functions[k] = (...a: number[]) => toNumber(v(...a));
    else {
      const n = toNumber(v);
      if (!Number.isNaN(n) || typeof v === 'number') constants[k] = n;
    }
  }
  return { constants, functions };
}

export function createMath(partial: Partial<MathConfig> = {}): CalciMath {
  const cfg: MathConfig = { ...DEFAULT_MATH_CONFIG, ...partial };
  const math = create(all, {
    number: cfg.bignumber ? 'BigNumber' : 'number',
    precision: cfg.precision,
    predictable: false,
  }) as CalciMath;
  math.calci = cfg;

  const orig = {
    sin: math.sin, cos: math.cos, tan: math.tan, sec: math.sec, csc: math.csc, cot: math.cot,
    asin: math.asin, acos: math.acos, atan: math.atan, asec: math.asec, acsc: math.acsc, acot: math.acot,
    atan2: math.atan2, log: math.log, log10: math.log10,
  } as Record<string, any>;

  const factor = () => (cfg.angle === 'deg' ? Math.PI / 180 : cfg.angle === 'grad' ? Math.PI / 200 : 1);
  const fullTurn = () => (cfg.angle === 'deg' ? 360 : cfg.angle === 'grad' ? 400 : 0);
  let bigPi: any = null;
  const bigFactor = () => {
    if (!bigPi) bigPi = (math as any).BigNumber.acos(-1);
    return cfg.angle === 'deg' ? bigPi.div(180) : cfg.angle === 'grad' ? bigPi.div(200) : new (math as any).BigNumber(1);
  };

  const QUARTER: Record<string, (q: number) => number> = {
    sin: (q) => [0, 1, 0, -1][q],
    cos: (q) => [1, 0, -1, 0][q],
    tan: (q) => [0, NaN, 0, NaN][q],
    sec: (q) => [1, NaN, -1, NaN][q],
    csc: (q) => [NaN, 1, NaN, -1][q],
    cot: (q) => [NaN, 0, NaN, 0][q],
  };

  const replacements: Record<string, any> = {};
  for (const name of ['sin', 'cos', 'tan', 'sec', 'csc', 'cot']) {
    const fn = orig[name];
    const num = (x: number) => {
      const full = fullTurn();
      if (full) {
        const r = ((x % full) + full) % full;
        const q = r / (full / 4);
        if (Number.isInteger(q)) return QUARTER[name](q);
      }
      const arg = x * factor();
      let v: number = fn(arg);
      if (Math.abs(v) < 1e-15 && Math.abs(arg) > 1e-6) v = 0;
      if (Math.abs(v) > 1e15 && (name === 'tan' || name === 'sec' || name === 'csc' || name === 'cot')) v = NaN;
      return v;
    };
    const sigs: Record<string, any> = {
      number: num,
      BigNumber: (x: any) => fn(cfg.angle === 'rad' ? x : x.times(bigFactor())),
      Complex: (x: any) => fn(x),
      Unit: (x: any) => fn(x),
      'Array | Matrix': (x: any) => math.map(x, (v: any) => replacements[name](v)),
    };
    replacements[name] = math.typed(name, sigs);
  }
  for (const name of ['asin', 'acos', 'atan', 'asec', 'acsc', 'acot']) {
    const fn = orig[name];
    const sigs: Record<string, any> = {
      number: (x: number) => {
        const r = fn(x);
        return typeof r === 'number' ? r / factor() : r;
      },
      BigNumber: (x: any) => {
        const r = fn(x);
        return r && r.isBigNumber && cfg.angle !== 'rad' ? r.div(bigFactor()) : r;
      },
      Complex: (x: any) => fn(x),
      'Array | Matrix': (x: any) => math.map(x, (v: any) => replacements[name](v)),
    };
    replacements[name] = math.typed(name, sigs);
  }
  replacements.atan2 = math.typed('atan2', {
    'number, number': (y: number, x: number) => Math.atan2(y, x) / factor(),
    'BigNumber, BigNumber': (y: any, x: any) => {
      const r = orig.atan2(y, x);
      return cfg.angle === 'rad' ? r : r.div(bigFactor());
    },
    'any, any': (y: any, x: any) => orig.atan2(y, x),
  });

  // log(x) is base 10 on calculators; ln(x) is natural.
  replacements.log = math.typed('log', {
    any: (x: any) => orig.log10(x),
    'any, any': (x: any, b: any) => orig.log(x, b),
  });
  replacements.ln = math.typed('ln', { any: (x: any) => orig.log(x) });

  const numOnly = (f: (...a: number[]) => number) => (...a: unknown[]) => f(...a.map(toNumber));

  replacements.nCr = (n: any, r: any) => math.combinations(n, r);
  replacements.nPr = (n: any, r: any) => math.permutations(n, r);
  replacements.root = (x: any, n: any = 2) => math.nthRoot(x, n);
  replacements.fact = (n: any) => math.factorial(n);
  replacements.ipart = (x: any) => math.fix(x);
  replacements.fpart = (x: any) => math.subtract(x, math.fix(x));
  replacements.frac = replacements.fpart;
  replacements.sgn = (x: any) => math.sign(x);
  replacements.rand = () => Math.random();
  replacements.randInt = (a: any, b: any) => math.randomInt(toNumber(a), toNumber(b) + 1);
  replacements.deg2rad = numOnly((x) => (x * Math.PI) / 180);
  replacements.rad2deg = numOnly((x) => (x * 180) / Math.PI);
  replacements.cbrt = math.typed('cbrt', {
    number: (x: number) => Math.cbrt(x),
    any: (x: any) => math.nthRoot(x, 3),
  });
  replacements.primeFactors = (nArg: any) => {
    let n = Math.abs(Math.round(toNumber(nArg)));
    if (!Number.isFinite(n) || n > Number.MAX_SAFE_INTEGER) throw new Error('primeFactors expects a safe integer');
    const out: number[] = [];
    for (let p = 2; p * p <= n; p += p === 2 ? 1 : 2) {
      while (n % p === 0) {
        out.push(p);
        n /= p;
      }
    }
    if (n > 1) out.push(n);
    return math.matrix(out);
  };
  replacements.digitsum = numOnly((x) => String(Math.abs(Math.trunc(x))).split('').reduce((s, d) => s + Number(d), 0));
  replacements.hypot2 = numOnly((a, b) => Math.hypot(a, b));
  replacements.sinc = numOnly((x) => (x === 0 ? 1 : Math.sin(x) / x));
  replacements.heaviside = numOnly((x) => (x < 0 ? 0 : x > 0 ? 1 : 0.5));
  replacements.clamp = numOnly((x, a, b) => Math.min(Math.max(x, a), b));
  replacements.lerp = numOnly((a, b, t) => a + (b - a) * t);
  replacements.stdev = (...a: any[]) => (math.std as any)(...a);
  for (const [k, f] of Object.entries(distributions)) replacements[k] = numOnly(f as any);

  // ---------------- in-expression calculus (raw-argument functions) ----------------
  const bodyFn = (body: MathNode, varName: string, scope: any): NumFn => {
    const inner = bodyFnRaw(body, varName, scope);
    if (!cfg.safe) return inner;
    const budget = (math as any).calciBudget as { ops: number; limit: number };
    return (x: number) => {
      if (++budget.ops > budget.limit) throw new Error('This calculation is too expensive to run here');
      return inner(x);
    };
  };
  const bodyFnRaw = (body: MathNode, varName: string, scope: any): NumFn => {
    try {
      const { constants, functions } = scopeToContext(scope);
      delete constants[varName];
      return compileNode(body, { vars: [varName], constants, functions, angle: cfg.angle });
    } catch (e) {
      if (!(e instanceof CompileError)) throw e;
      const code = body.compile();
      const child = new ChildScope(scope);
      return (x: number) => {
        child.set(varName, x);
        return toNumber(code.evaluate(child));
      };
    }
  };
  const symName = (n: MathNode, fn: string): string => {
    const s = n as any;
    if (s.type !== 'SymbolNode') throw new Error(`${fn}: the variable argument must be a name, e.g. x`);
    return s.name;
  };
  const evalNum = (n: MathNode, scope: any): number => toNumber(n.compile().evaluate(scope));
  const out = (v: number) => (cfg.bignumber ? math.bignumber(v) : v);

  const integral = (args: MathNode[], _m: unknown, scope: any) => {
    if (args.length !== 4) throw new Error('integral(f, x, a, b) takes 4 arguments');
    const f = bodyFn(args[0], symName(args[1], 'integral'), scope);
    return out(N.clean(N.integrate(f, evalNum(args[2], scope), evalNum(args[3], scope)).value, 14));
  };
  const diff = (args: MathNode[], _m: unknown, scope: any) => {
    if (args.length < 3) throw new Error('diff(f, x, a [, order]) takes 3 or 4 arguments');
    const f = bodyFn(args[0], symName(args[1], 'diff'), scope);
    const order = args[3] ? evalNum(args[3], scope) : 1;
    return out(N.clean(N.derivative(f, evalNum(args[2], scope), order), order > 1 ? 8 : 11));
  };
  const sigma = (args: MathNode[], _m: unknown, scope: any) => {
    if (args.length !== 4) throw new Error('sigma(f, n, a, b) takes 4 arguments');
    const f = bodyFn(args[0], symName(args[1], 'sigma'), scope);
    return out(N.series(f, evalNum(args[2], scope), evalNum(args[3], scope)).value);
  };
  const product = (args: MathNode[], _m: unknown, scope: any) => {
    if (args.length !== 4) throw new Error('product(f, n, a, b) takes 4 arguments');
    const f = bodyFn(args[0], symName(args[1], 'product'), scope);
    return out(N.product(f, evalNum(args[2], scope), evalNum(args[3], scope)));
  };
  const limit = (args: MathNode[], _m: unknown, scope: any) => {
    if (args.length < 3) throw new Error('limit(f, x, a) takes 3 arguments');
    const f = bodyFn(args[0], symName(args[1], 'limit'), scope);
    const r = N.limit(f, evalNum(args[2], scope));
    return out(r.value);
  };
  const nsolve = (args: MathNode[], _m: unknown, scope: any) => {
    if (args.length < 2) throw new Error('nsolve(f, x [, guess]) takes 2 or 3 arguments');
    let body = args[0] as any;
    if (body.type === 'AssignmentNode' || (body.type === 'OperatorNode' && body.fn === 'equal')) {
      const lhs = body.type === 'AssignmentNode' ? body.object : body.args[0];
      const rhs = body.type === 'AssignmentNode' ? body.value : body.args[1];
      body = new (math as any).OperatorNode('-', 'subtract', [lhs, rhs]);
    }
    const f = bodyFn(body, symName(args[1], 'nsolve'), scope);
    const guess = args[2] ? evalNum(args[2], scope) : 0;
    let r = N.newton(f, guess);
    if (Number.isNaN(r)) {
      const roots = N.findRoots(f, guess - 100, guess + 100, 4000);
      if (roots.length) r = roots.reduce((best, x) => (Math.abs(x - guess) < Math.abs(best - guess) ? x : best));
    }
    if (Number.isNaN(r)) throw new Error('nsolve: no root found near the initial guess');
    return out(N.clean(r, 13));
  };
  for (const f of [integral, diff, sigma, product, limit, nsolve]) (f as any).rawArgs = true;
  Object.assign(replacements, {
    integral, nInt: integral, fnInt: integral,
    diff, nDeriv: diff,
    sigma, summation: sigma,
    product,
    limit,
    nsolve, solve: nsolve,
  });

  // Keep the real parser for our own use before safe mode stubs it out.
  const rawParse = math.parse.bind(math) as CalciMath['parse'];

  if (cfg.safe) {
    const LIMIT = 1_000_000;
    const err = (name: string) => new Error(`${name}: size limit exceeded`);
    /** Number of elements a size-like argument would produce. */
    const sizeOf = (v: any): number => {
      if (typeof v === 'number' || v?.isBigNumber) return Math.abs(toNumber(v));
      if (Array.isArray(v) || v?.isMatrix) {
        const arr: unknown[] = v?.isMatrix ? v.toArray() : v;
        if (arr.length <= 4 && arr.every((x) => typeof x === 'number' || (x as any)?.isBigNumber)) return arr.reduce((p: number, x) => p * Math.abs(toNumber(x)), 1);
        return arr.length;
      }
      if (typeof v === 'string') return 0;
      return 1;
    };
    const guard = (name: string) => {
      const fn = (math as any)[name];
      return (...a: any[]) => {
        const total = a.reduce((p: number, v) => p * Math.max(1, sizeOf(v)), 1);
        if (!(total <= LIMIT)) throw err(name);
        return fn(...a);
      };
    };
    for (const name of ['zeros', 'ones', 'identity', 'resize', 'reshape', 'random', 'randomInt', 'pickRandom']) replacements[name] = guard(name);
    replacements.range = (...a: any[]) => {
      const nums = a.map((v) => (typeof v === 'string' ? v.split(':').map(Number) : [toNumber(v)])).flat();
      if (nums.length >= 2) {
        const step = nums.length > 2 ? nums[2] : 1;
        if (!(Math.abs((nums[1] - nums[0]) / (step || 1)) <= LIMIT)) throw err('range');
      }
      return (math.range as any)(...a);
    };
    const kron = math.kron;
    replacements.kron = (a: any, b: any) => {
      const count = (m: any) => (m?.isMatrix ? m.size() : math.size(m) as any).reduce?.((p: number, d: any) => p * toNumber(d), 1) ?? 1;
      if (!(toNumber(count(a)) * toNumber(count(b)) <= LIMIT)) throw err('kron');
      return kron(a, b);
    };
    // Throwing stubs: even math.js's own internal constant folding can't reach these.
    for (const name of STUBBED_FUNCTIONS) {
      replacements[name] = () => {
        throw new Error(`Function ${name} is disabled`);
      };
    }
  }

  math.import(replacements, { override: true });
  (math as any).calciParse = rawParse;
  (math as any).calciBudget = { ops: 0, limit: cfg.safe ? 10_000_000 : Infinity };
  return math;
}

/**
 * Validate an untrusted expression string before handing it to code paths that
 * use non-safe instances (symbolic calculus, compiled numerics). Throws on violation.
 */
export function validateUntrusted(src: string, prepareFn: (s: string) => string = (s) => s): void {
  if (src.length > 2000) throw new Error('Expression too long');
  for (const part of prepareFn(src).split(/(?<![<>!=])=(?!=)/)) {
    if (part.trim()) assertSafe(parseUntrusted(part));
  }
}
let pristine: MathJsInstance | null = null;
function parseUntrusted(src: string): MathNode {
  pristine ??= create(all);
  return pristine.parse(src);
}

/** The unstubbed parser (safe instances replace math.parse with a stub). */
export function parseWith(math: CalciMath, src: string): MathNode {
  return ((math as any).calciParse ?? math.parse)(src);
}

/** Reset the per-evaluation operation budget (safe mode CPU limit). */
export function resetBudget(math: CalciMath) {
  const b = (math as any).calciBudget;
  if (b) b.ops = 0;
}

/** Throw if a parsed expression calls a function that is unsafe for untrusted input. */
export function assertSafe(node: MathNode): void {
  node.traverse((n: any) => {
    // String literals are how every escape works (evaluate("…"), createUnit("…"), symbolicEqual("…")).
    if (n.type === 'ConstantNode' && typeof n.value === 'string') throw new Error('Text strings are not allowed here');
    // User-defined functions allow unbounded recursion.
    if (n.type === 'FunctionAssignmentNode') throw new Error('Defining functions is not allowed here');
    if (n.type === 'FunctionNode') {
      const name = n.fn?.name;
      if (name && UNSAFE_FUNCTIONS.has(name)) throw new Error(`Function ${name} is disabled`);
    }
    if (n.type === 'SymbolNode' && UNSAFE_FUNCTIONS.has(n.name)) throw new Error(`Symbol ${n.name} is disabled`);
    if (n.type === 'AccessorNode' || n.type === 'IndexNode') {
      const s = n.toString();
      if (/constructor|__proto__|prototype/.test(s)) throw new Error('Property access is disabled');
    }
  });
}
