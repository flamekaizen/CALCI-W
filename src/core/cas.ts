/**
 * Computer algebra: rule-based symbolic integration, polynomial factoring over
 * the rationals, and polynomial / rational inequality solving.
 *
 * Symbolic work happens on a pristine math.js instance (natural-log `log`), with
 * the calculator's log = log10 / ln = natural log convention translated around it,
 * exactly like calculus.ts.
 */
import { create, all, type MathJsInstance } from 'mathjs';
import { createMath, type CalciMath } from './math.js';
import { prepare } from './engine.js';
import { expressionTex, exactForm, toFraction } from './format.js';
import { polyRoots, solveLinear } from './solver.js';

/* ------------------------------------------------------------------------------ */
/*                                  shared helpers                                */
/* ------------------------------------------------------------------------------ */

/** math.js node typings are too loose to be useful for tree surgery. */
type Node = any;

let pristine: MathJsInstance | null = null;
const M = (): any => (pristine ??= create(all));
let calc: CalciMath | null = null;
const getCalc = () => (calc ??= createMath());

function toMathjsLogs(node: Node): Node {
  return node.transform((n: Node) => {
    if (n.type === 'FunctionNode' && n.fn?.name === 'ln') return new (M().FunctionNode)('log', n.args);
    if (n.type === 'FunctionNode' && n.fn?.name === 'log' && n.args.length === 1) return new (M().FunctionNode)('log', [n.args[0], cnst(10)]);
    return n;
  });
}
function fromMathjsLogs(node: Node): Node {
  return node.transform((n: Node) => {
    if (n.type === 'FunctionNode' && n.fn?.name === 'log' && n.args.length === 1) return new (M().FunctionNode)('ln', n.args);
    if (n.type === 'FunctionNode' && n.fn?.name === 'log' && n.args.length === 2) {
      const b = n.args[1];
      if (b.type === 'ConstantNode' && b.value === 10) return new (M().FunctionNode)('log', [n.args[0]]);
    }
    return n;
  });
}

/** Largest denominator accepted when recognising a float as an exact fraction. */
const MAX_DEN = 100_000;

const cnst = (v: number): Node => new (M().ConstantNode)(v);
const sym = (name: string): Node => new (M().SymbolNode)(name);
const opn = (op: string, fn: string, args: Node[]): Node => new (M().OperatorNode)(op, fn, args);
const fnc = (name: string, ...args: Node[]): Node => new (M().FunctionNode)(name, args);

function strip(n: Node): Node {
  while (n.type === 'ParenthesisNode') n = n.content;
  return n;
}
const isOp = (n: Node, fn: string) => n.type === 'OperatorNode' && n.fn === fn;

/** Numeric value of a plain constant node (incl. unary minus), else null. */
function numVal(n: Node): number | null {
  n = strip(n);
  if (n.type === 'ConstantNode' && typeof n.value === 'number') return n.value;
  if (isOp(n, 'unaryMinus')) {
    const v = numVal(n.args[0]);
    return v === null ? null : -v;
  }
  return null;
}

function dependsOn(node: Node, v: string): boolean {
  let found = false;
  node.traverse((n: Node) => {
    if (n.type === 'SymbolNode' && n.name === v) found = true;
  });
  return found;
}

function nodeSize(node: Node): number {
  let k = 0;
  node.traverse(() => {
    k++;
  });
  return k;
}

/** Evaluate a variable-free node to a finite real number, else null. */
function evalConst(node: Node): number | null {
  try {
    const r = node.compile().evaluate({});
    return typeof r === 'number' && Number.isFinite(r) ? r : null;
  } catch {
    return null;
  }
}

function evalAt(code: { evaluate: (s: object) => unknown }, v: string, x: number): number {
  try {
    const r = code.evaluate({ [v]: x });
    return typeof r === 'number' ? r : NaN;
  } catch {
    return NaN;
  }
}

/* ------------------------------ smart constructors ------------------------------ */

function isNeg(n: Node): boolean {
  n = strip(n);
  if (isOp(n, 'unaryMinus')) return true;
  if ((isOp(n, 'multiply') || isOp(n, 'divide')) && n.args.length === 2) return isNeg(n.args[0]);
  const v = numVal(n);
  return v !== null && v < 0;
}

function neg(n: Node): Node {
  const s = strip(n);
  if (isOp(s, 'unaryMinus')) return s.args[0];
  if (s.type === 'ConstantNode' && typeof s.value === 'number') return s.value === 0 ? s : s.value < 0 ? cnst(-s.value) : opn('-', 'unaryMinus', [s]);
  if ((isOp(s, 'multiply') || isOp(s, 'divide')) && s.args.length === 2) return opn(s.op, s.fn, [neg(s.args[0]), s.args[1]]);
  return opn('-', 'unaryMinus', [n]);
}

function add(a: Node, b: Node): Node {
  if (numVal(a) === 0) return b;
  if (numVal(b) === 0) return a;
  // a + (b0 ± b1) → (a + b0) ± b1, so signs stay readable
  if ((isOp(b, 'add') || isOp(b, 'subtract')) && b.args.length === 2) return isOp(b, 'add') ? add(add(a, b.args[0]), b.args[1]) : sub(add(a, b.args[0]), b.args[1]);
  if (isNeg(b)) return opn('-', 'subtract', [a, neg(b)]);
  return opn('+', 'add', [a, b]);
}

function sub(a: Node, b: Node): Node {
  if (numVal(b) === 0) return a;
  if (numVal(a) === 0) return neg(b);
  if ((isOp(b, 'add') || isOp(b, 'subtract')) && b.args.length === 2) return isOp(b, 'add') ? sub(sub(a, b.args[0]), b.args[1]) : add(sub(a, b.args[0]), b.args[1]);
  if (isNeg(b)) return opn('+', 'add', [a, neg(b)]);
  return opn('-', 'subtract', [a, b]);
}

function mul(a: Node, b: Node): Node {
  const va = numVal(a);
  const vb = numVal(b);
  if (va === 0 || vb === 0) return cnst(0);
  if (va === 1) return b;
  if (vb === 1) return a;
  if (va !== null && vb !== null) return num(va * vb);
  if (va === -1) return neg(b);
  if (vb === -1) return neg(a);
  if (isNeg(a)) return neg(mul(neg(a), b));
  if (isNeg(b)) return neg(mul(a, neg(b)));
  return opn('*', 'multiply', [a, b]);
}

function div(a: Node, b: Node): Node {
  if (numVal(b) === 1) return a;
  if (isNeg(a)) return neg(div(neg(a), b));
  return opn('/', 'divide', [a, b]);
}

function pow(b: Node, e: number): Node {
  if (e === 1) return b;
  if (e === 0) return cnst(1);
  return opn('^', 'pow', [b, num(e)]);
}

/** Number → node, as an exact fraction or multiple of pi when recognisable. */
function num(c: number): Node {
  if (c < 0) return neg(num(-c));
  if (Number.isInteger(c)) return cnst(c);
  const fr = toFraction(c, MAX_DEN, 1e-12);
  if (fr) return opn('/', 'divide', [cnst(fr[0]), cnst(fr[1])]);
  const fp = toFraction(c / Math.PI, 1000, 1e-12);
  if (fp) return fp[1] === 1 ? mul(cnst(fp[0]), sym('pi')) : div(mul(cnst(fp[0]), sym('pi')), cnst(fp[1]));
  return cnst(Number(c.toPrecision(15)));
}

/** c * node with numeric normalisation (x^3/3 * 3 → x^3, -cos(u)/2, …). */
function scale(node: Node, c: number): Node {
  if (c === 0) return cnst(0);
  if (c === 1) return node;
  const s = strip(node);
  if (isOp(s, 'unaryMinus')) return scale(s.args[0], -c);
  if ((isOp(s, 'add') || isOp(s, 'subtract')) && s.args.length === 2) {
    const a = scale(s.args[0], c);
    const b = scale(s.args[1], c);
    return isOp(s, 'add') ? add(a, b) : sub(a, b);
  }
  if (isOp(s, 'divide') && s.args.length === 2) {
    const d = numVal(s.args[1]);
    if (d !== null && d !== 0) return scale(s.args[0], c / d);
    const k = numVal(s.args[0]);
    if (k !== null) {
      // k/D · c → p/(q·D)
      const v = k * c;
      const fr = toFraction(Math.abs(v), MAX_DEN, 1e-12);
      if (!fr) return div(num(v), s.args[1]);
      const out = div(cnst(fr[0]), fr[1] === 1 ? s.args[1] : mul(cnst(fr[1]), s.args[1]));
      return v < 0 ? neg(out) : out;
    }
  }
  if (isOp(s, 'multiply') && s.args.length === 2) {
    const k = numVal(s.args[0]);
    if (k !== null) return scale(s.args[1], c * k);
  }
  const k = numVal(s);
  if (k !== null) return num(k * c);
  if (c < 0) return neg(scale(node, -c));
  if (Number.isInteger(c)) return mul(cnst(c), node);
  const fr = toFraction(c, MAX_DEN, 1e-12);
  if (fr) return div(fr[0] === 1 ? node : mul(cnst(fr[0]), node), cnst(fr[1]));
  return mul(num(c), node);
}

const logAbs = (u: Node) => fnc('log', fnc('abs', u));
/** base^e, written as 1/base^|e| for negative e. */
const powSigned = (base: Node, e: number): Node => (e < 0 ? div(cnst(1), pow(base, -e)) : pow(base, e));

/* --------------------------------- polynomials --------------------------------- */

const MAX_DEG = 64;

function trim(c: number[]): number[] {
  const r = c.slice();
  while (r.length > 1 && r[r.length - 1] === 0) r.pop();
  return r;
}
function pAdd(a: number[], b: number[], s = 1): number[] {
  const r = new Array(Math.max(a.length, b.length)).fill(0);
  a.forEach((v, i) => (r[i] += v));
  b.forEach((v, i) => (r[i] += s * v));
  return trim(r);
}
function pMul(a: number[], b: number[]): number[] {
  const r = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) r[i + j] += a[i] * b[j];
  return trim(r);
}
function pPow(a: number[], n: number): number[] {
  let r = [1];
  for (let i = 0; i < n; i++) r = pMul(r, a);
  return r;
}
const pDeriv = (a: number[]) => (a.length <= 1 ? [0] : a.slice(1).map((v, i) => v * (i + 1)));
const pInt = (a: number[]) => trim([0, ...a.map((v, i) => v / (i + 1))]);
const pEval = (a: number[], x: number) => a.reduceRight((acc, v) => acc * x + v, 0);
const pDeg = (a: number[]) => (a.length === 1 && a[0] === 0 ? -1 : a.length - 1);
const pIsZero = (a: number[]) => a.every((v) => v === 0);
/** Clean float noise so that exact fractions are recognised. */
const pClean = (a: number[]) =>
  trim(
    a.map((v) => {
      if (Math.abs(v) < 1e-13) return 0;
      const fr = toFraction(v, MAX_DEN, 1e-12);
      return fr ? fr[0] / fr[1] : v;
    }),
  );
/** Divide a by b: [quotient, remainder]. */
function pDivMod(a: number[], b: number[]): [number[], number[]] {
  const r = a.slice();
  const db = b.length - 1;
  if (r.length - 1 < db) return [[0], trim(r)];
  const q = new Array(r.length - db).fill(0);
  for (let i = r.length - 1; i >= db; i--) {
    const c = r[i] / b[db];
    q[i - db] = c;
    for (let j = 0; j <= db; j++) r[i - db + j] -= c * b[j];
  }
  return [trim(q), trim(r.slice(0, db).length ? r.slice(0, db) : [0])];
}

/** Coefficients (lowest degree first) if node is a polynomial in v with numeric coefficients. */
function polyCoeffs(node: Node, v: string): number[] | null {
  node = strip(node);
  if (!dependsOn(node, v)) {
    const c = evalConst(node);
    return c === null ? null : [c];
  }
  if (node.type === 'SymbolNode') return [0, 1];
  if (node.type !== 'OperatorNode') return null;
  const [a, b] = node.args;
  switch (node.fn) {
    case 'unaryPlus':
      return polyCoeffs(a, v);
    case 'unaryMinus': {
      const p = polyCoeffs(a, v);
      return p && p.map((x) => -x);
    }
    case 'add':
    case 'subtract': {
      const p = polyCoeffs(a, v);
      const q = p && polyCoeffs(b, v);
      return q && pAdd(p!, q, node.fn === 'add' ? 1 : -1);
    }
    case 'multiply': {
      let r: number[] | null = [1];
      for (const arg of node.args) {
        const p = polyCoeffs(arg, v);
        if (!p) return null;
        r = pMul(r, p);
        if (r.length - 1 > MAX_DEG) return null;
      }
      return r;
    }
    case 'divide': {
      if (dependsOn(b, v)) return null;
      const d = evalConst(b);
      const p = polyCoeffs(a, v);
      return p && d ? p.map((x) => x / d) : null;
    }
    case 'pow': {
      if (dependsOn(b, v)) return null;
      const e = evalConst(b);
      if (e === null || !Number.isInteger(e) || e < 0 || e > MAX_DEG) return null;
      const p = polyCoeffs(a, v);
      if (!p || (p.length - 1) * e > MAX_DEG) return null;
      return pPow(p, e);
    }
    default:
      return null;
  }
}

/** Numerator / denominator coefficients if node is a rational function of v. */
function ratCoeffs(node: Node, v: string): { n: number[]; d: number[] } | null {
  node = strip(node);
  const p = polyCoeffs(node, v);
  if (p) return { n: p, d: [1] };
  if (node.type !== 'OperatorNode') return null;
  const [a, b] = node.args;
  const same = (x: number[], y: number[]) => x.length === y.length && x.every((c, i) => c === y[i]);
  switch (node.fn) {
    case 'unaryPlus':
      return ratCoeffs(a, v);
    case 'unaryMinus': {
      const r = ratCoeffs(a, v);
      return r && { n: r.n.map((x) => -x), d: r.d };
    }
    case 'add':
    case 'subtract': {
      const r = ratCoeffs(a, v);
      const s = r && ratCoeffs(b, v);
      if (!r || !s) return null;
      const sg = node.fn === 'add' ? 1 : -1;
      if (same(r.d, s.d)) return { n: pAdd(r.n, s.n, sg), d: r.d };
      return { n: pAdd(pMul(r.n, s.d), pMul(s.n, r.d), sg), d: pMul(r.d, s.d) };
    }
    case 'multiply': {
      let acc: { n: number[]; d: number[] } = { n: [1], d: [1] };
      for (const arg of node.args) {
        const r = ratCoeffs(arg, v);
        if (!r) return null;
        acc = { n: pMul(acc.n, r.n), d: pMul(acc.d, r.d) };
      }
      return acc.n.length + acc.d.length > 2 * MAX_DEG ? null : acc;
    }
    case 'divide': {
      const r = ratCoeffs(a, v);
      const s = r && ratCoeffs(b, v);
      if (!r || !s || pIsZero(s.n)) return null;
      return { n: pMul(r.n, s.d), d: pMul(r.d, s.n) };
    }
    case 'pow': {
      if (dependsOn(b, v)) return null;
      const e = evalConst(b);
      if (e === null || !Number.isInteger(e) || Math.abs(e) > MAX_DEG) return null;
      const r = ratCoeffs(a, v);
      if (!r) return null;
      return e >= 0 ? { n: pPow(r.n, e), d: pPow(r.d, e) } : { n: pPow(r.d, -e), d: pPow(r.n, -e) };
    }
    default:
      return null;
  }
}

function linearOf(node: Node, v: string): { a: number; b: number } | null {
  const p = polyCoeffs(node, v);
  return p && p.length === 2 && p[1] !== 0 ? { a: p[1], b: p[0] } : null;
}

/** Polynomial (lowest degree first) → node in descending powers of x. */
function polyNode(c: number[], x: Node): Node {
  let out: Node | null = null;
  for (let k = c.length - 1; k >= 0; k--) {
    if (c[k] === 0) continue;
    const term = k === 0 ? cnst(1) : k === 1 ? x : pow(x, k);
    if (out === null) out = scale(term, c[k]);
    else out = c[k] < 0 ? sub(out, scale(term, -c[k])) : add(out, scale(term, c[k]));
  }
  return out ?? cnst(0);
}
const linNode = (a: number, b: number, v: string) => polyNode(pClean([b, a]), sym(v));

/* ------------------------------------------------------------------------------ */
/*                                    integration                                 */
/* ------------------------------------------------------------------------------ */

interface Factor {
  base: Node;
  exp: number;
}

const SUB_VAR = '__u';

/** Split a product/quotient into a constant part and dependent factors base^exp. */
function factorize(node: Node, v: string): { coef: Node; factors: Factor[] } {
  let coef: Node = cnst(1);
  const factors: Factor[] = [];
  const pushConst = (n: Node, s: number) => {
    coef = s > 0 ? mul(coef, n) : div(coef, n);
  };
  const walk = (n: Node, s: number) => {
    n = strip(n);
    if (!dependsOn(n, v)) return pushConst(n, s);
    if (n.type === 'OperatorNode') {
      if (n.fn === 'multiply') return n.args.forEach((a: Node) => walk(a, s));
      if (n.fn === 'divide') {
        walk(n.args[0], s);
        return walk(n.args[1], -s);
      }
      if (n.fn === 'unaryMinus') {
        coef = neg(coef);
        return walk(n.args[0], s);
      }
      if (n.fn === 'unaryPlus') return walk(n.args[0], s);
      if (n.fn === 'pow') {
        const [b, e] = n.args;
        if (!dependsOn(e, v)) {
          const ev = evalConst(e);
          if (ev !== null) {
            const sb = strip(b);
            // (u^p)^q → u^(pq) unless that would drop an absolute value
            if (isOp(sb, 'pow') && !dependsOn(sb.args[1], v)) {
              const p = evalConst(sb.args[1]);
              if (p !== null && !(Number.isInteger(p) && p % 2 === 0 && !Number.isInteger(ev))) {
                factors.push({ base: strip(sb.args[0]), exp: p * ev * s });
                return;
              }
            }
            if (sb.type === 'FunctionNode' && (sb.fn.name === 'sqrt' || sb.fn.name === 'cbrt')) {
              factors.push({ base: strip(sb.args[0]), exp: (ev * s) / (sb.fn.name === 'sqrt' ? 2 : 3) });
              return;
            }
            factors.push({ base: sb, exp: ev * s });
            return;
          }
        }
        if (s < 0 && !dependsOn(b, v)) {
          factors.push({ base: opn('^', 'pow', [b, neg(e)]), exp: 1 });
          return;
        }
      }
    }
    if (n.type === 'FunctionNode') {
      const name = n.fn.name;
      if (name === 'sqrt') return void factors.push({ base: strip(n.args[0]), exp: s / 2 });
      if (name === 'cbrt') return void factors.push({ base: strip(n.args[0]), exp: s / 3 });
      if (name === 'nthRoot' && n.args.length === 2) {
        const k = evalConst(n.args[1]);
        if (k) return void factors.push({ base: strip(n.args[0]), exp: s / k });
      }
      if (name === 'exp') {
        const u = n.args[0];
        return void factors.push({ base: opn('^', 'pow', [sym('e'), s > 0 ? u : neg(u)]), exp: 1 });
      }
    }
    factors.push({ base: n, exp: s });
  };
  walk(node, 1);
  // merge equal bases
  const merged = new Map<string, Factor>();
  for (const f of factors) {
    const k = f.base.toString();
    const m = merged.get(k);
    if (m) m.exp += f.exp;
    else merged.set(k, { ...f });
  }
  return { coef, factors: [...merged.values()].filter((f) => Math.abs(f.exp) > 1e-15) };
}

const fNode = (f: Factor) => pow(f.base, f.exp);
function productNode(fs: Factor[]): Node {
  return fs.reduce<Node>((acc, f) => mul(acc, fNode(f)), cnst(1));
}

/** Multiply an antiderivative by a constant coefficient node. */
function times(coef: Node, r: Node): Node {
  const c = numVal(coef) ?? (dependsOn(coef, '\u0000') ? null : null);
  if (c !== null) return scale(r, c);
  const cv = evalConst(coef);
  if (cv !== null && toFraction(cv, MAX_DEN, 1e-12)) return scale(r, cv);
  return mul(coef, r);
}

function integrate(node: Node, v: string, depth: number): Node | null {
  if (depth > 6) return null;
  node = strip(node);
  const x = sym(v);
  if (!dependsOn(node, v)) return mul(node, x);
  if (node.type === 'OperatorNode') {
    if (node.fn === 'add' || node.fn === 'subtract') {
      const a = integrate(node.args[0], v, depth);
      const b = a && integrate(node.args[1], v, depth);
      if (a && b) return node.fn === 'add' ? add(a, b) : sub(a, b);
      return integrateWhole(node, v, depth);
    }
    if (node.fn === 'unaryMinus') {
      const a = integrate(node.args[0], v, depth);
      return a && neg(a);
    }
    if (node.fn === 'unaryPlus') return integrate(node.args[0], v, depth);
  }
  const { coef, factors } = factorize(node, v);
  // (ax+b)^n by linear substitution rather than expansion
  const linearPower = factors.length === 1 && factors[0].exp !== 1 && linearOf(factors[0].base, v) !== null;
  if (!linearPower) {
    const p = polyCoeffs(node, v);
    if (p) return polyNode(pClean(pInt(p)), x);
  }
  const r = integrateProduct(factors, v, depth);
  if (r) return times(coef, r);
  return integrateWhole(node, v, depth);
}

/** Last-resort strategies on the whole integrand: rational functions, simplification. */
function integrateWhole(node: Node, v: string, depth: number): Node | null {
  const rat = ratCoeffs(node, v);
  if (rat && pDeg(rat.d) >= 1) {
    const r = integrateRational(rat.n, rat.d, v);
    if (r) return r;
  }
  try {
    const s = M().simplify(node);
    if (s.toString() !== node.toString()) return integrate(s, v, depth + 1);
  } catch {
    /* ignore */
  }
  return null;
}

function integrateProduct(factors: Factor[], v: string, depth: number): Node | null {
  const x = sym(v);
  if (factors.length === 0) return x;
  if (factors.length === 1) {
    const r = integrateSingle(factors[0], v, depth);
    if (r) return r;
    return uSub(factors, v, depth);
  }
  // split into a polynomial part and the rest
  let poly: number[] = [1];
  const others: Factor[] = [];
  for (const f of factors) {
    const p = Number.isInteger(f.exp) && f.exp > 0 ? polyCoeffs(f.base, v) : null;
    if (p && pDeg(p) >= 1) poly = pMul(poly, pPow(p, f.exp));
    else others.push(f);
  }
  if (others.length === 1 && others[0].exp === 1 && pDeg(poly) >= 1) {
    const r = tabular(pClean(poly), others[0].base, v) ?? polyTimesLog(pClean(poly), others[0].base, v);
    if (r) return r;
  }
  if (factors.length === 2) {
    const r = pairRule(factors[0], factors[1], v, depth);
    if (r) return r;
  }
  const r = uSub(factors, v, depth);
  if (r) return r;
  // rational function made of several polynomial factors
  const rat = ratCoeffs(productNode(factors), v);
  if (rat && pDeg(rat.d) >= 1) return integrateRational(rat.n, rat.d, v);
  return null;
}

/** ∫ base^exp dx for a single dependent factor. */
function integrateSingle(f: Factor, v: string, depth: number): Node | null {
  const x = sym(v);
  const { base, exp } = f;
  if (exp === 1) return integrateAtom(base, v);
  const lin = linearOf(base, v);
  if (lin) {
    if (Math.abs(exp + 1) < 1e-15) return scale(logAbs(base), 1 / lin.a);
    return scale(powSigned(base, exp + 1), 1 / ((exp + 1) * lin.a));
  }
  const p = polyCoeffs(base, v);
  if (p && pDeg(p) >= 1) {
    if (Number.isInteger(exp) && exp > 0) return polyNode(pClean(pInt(pPow(p, exp))), x);
    if (Number.isInteger(exp) && exp < 0) return integrateRational([1], pPow(p, -exp), v);
    if (exp === -0.5 && pDeg(p) === 2) return invSqrtQuadratic(p, base, v);
  }
  // powers of trig functions of a linear argument
  if (base.type === 'FunctionNode' && base.args.length === 1) {
    const u = base.args[0];
    const l = linearOf(u, v);
    const name = base.fn.name as string;
    if (l) {
      const a = l.a;
      const doubled = linNode(2 * l.a, 2 * l.b, v);
      if (exp === 2) {
        switch (name) {
          case 'sin':
            return sub(div(x, cnst(2)), scale(fnc('sin', doubled), 1 / (4 * a)));
          case 'cos':
            return add(div(x, cnst(2)), scale(fnc('sin', doubled), 1 / (4 * a)));
          case 'tan':
            return sub(scale(fnc('tan', u), 1 / a), x);
          case 'cot':
            return sub(scale(fnc('cot', u), -1 / a), x);
          case 'sec':
            return scale(fnc('tan', u), 1 / a);
          case 'csc':
            return scale(fnc('cot', u), -1 / a);
          case 'sinh':
            return sub(scale(fnc('sinh', doubled), 1 / (4 * a)), div(x, cnst(2)));
          case 'cosh':
            return add(scale(fnc('sinh', doubled), 1 / (4 * a)), div(x, cnst(2)));
        }
      }
      if (exp === -2) {
        if (name === 'cos') return scale(fnc('tan', u), 1 / a);
        if (name === 'sin') return scale(fnc('cot', u), -1 / a);
        if (name === 'cosh') return scale(fnc('tanh', u), 1 / a);
      }
      if (exp === -1) {
        const recip: Record<string, string> = { sin: 'csc', cos: 'sec', tan: 'cot', cot: 'tan', sec: 'cos', csc: 'sin' };
        if (recip[name]) return integrateAtom(fnc(recip[name], u), v);
      }
      // reduction formulas for sin^n, cos^n (n ≥ 3)
      if (Number.isInteger(exp) && exp >= 3 && exp <= 12 && (name === 'sin' || name === 'cos')) {
        const rest = integrateSingle({ base, exp: exp - 2 }, v, depth);
        if (!rest) return null;
        const other = fnc(name === 'sin' ? 'cos' : 'sin', u);
        const head = scale(mul(pow(base, exp - 1), other), (name === 'sin' ? -1 : 1) / (exp * a));
        return add(head, scale(rest, (exp - 1) / exp));
      }
    }
  }
  // (a^u)^n = a^(n u)
  if (isOp(base, 'pow') && !dependsOn(base.args[0], v)) return integrateAtom(opn('^', 'pow', [base.args[0], scale(base.args[1], exp)]), v);
  return null;
}

/** ∫ g dx for a single elementary function / exponential. */
function integrateAtom(g: Node, v: string): Node | null {
  g = strip(g);
  const x = sym(v);
  if (g.type === 'SymbolNode' && g.name === v) return div(pow(x, 2), cnst(2));
  if (isOp(g, 'pow')) {
    if (!dependsOn(g.args[0], v)) {
      const ex = expRate(g, v);
      if (ex) {
        if (numVal(ex.lnBase) === 1) return scale(g, 1 / ex.k);
        // a^(kx) / (k ln a)
        if (Number.isInteger(ex.k)) {
          const den = Math.abs(ex.k) === 1 ? ex.lnBase : mul(cnst(Math.abs(ex.k)), ex.lnBase);
          return ex.k < 0 ? neg(div(g, den)) : div(g, den);
        }
        return scale(div(g, ex.lnBase), 1 / ex.k);
      }
    }
    return null;
  }
  if (g.type !== 'FunctionNode') return null;
  const name = g.fn.name as string;
  const u = g.args[0];
  const l = linearOf(u, v);
  if (!l) return null;
  const k = 1 / l.a;
  if (g.args.length === 2) {
    if (name === 'log' && !dependsOn(g.args[1], v)) {
      const r = polyTimesLog([1], fnc('log', u), v);
      return r && div(r, fnc('log', g.args[1]));
    }
    return null;
  }
  switch (name) {
    case 'sin':
      return scale(fnc('cos', u), -k);
    case 'cos':
      return scale(fnc('sin', u), k);
    case 'tan':
      return scale(logAbs(fnc('cos', u)), -k);
    case 'cot':
      return scale(logAbs(fnc('sin', u)), k);
    case 'sec':
      return scale(logAbs(add(fnc('sec', u), fnc('tan', u))), k);
    case 'csc':
      return scale(logAbs(add(fnc('csc', u), fnc('cot', u))), -k);
    case 'sinh':
      return scale(fnc('cosh', u), k);
    case 'cosh':
      return scale(fnc('sinh', u), k);
    case 'tanh':
      return scale(fnc('log', fnc('cosh', u)), k);
    case 'exp':
      return scale(g, k);
    case 'log':
      return polyTimesLog([1], g, v);
    case 'log10':
    case 'log2': {
      const r = polyTimesLog([1], fnc('log', u), v);
      return r && div(r, fnc('log', cnst(name === 'log10' ? 10 : 2)));
    }
    case 'abs':
      return scale(mul(u, g), k / 2);
    case 'asin':
      return scale(add(mul(u, g), fnc('sqrt', sub(cnst(1), pow(u, 2)))), k);
    case 'acos':
      return scale(sub(mul(u, g), fnc('sqrt', sub(cnst(1), pow(u, 2)))), k);
    case 'atan':
      return scale(sub(mul(u, g), div(fnc('log', add(cnst(1), pow(u, 2))), cnst(2))), k);
    default:
      return null;
  }
}

/** For a^(kx+c) (incl. e^u): k and a node for ln(a). */
function expRate(g: Node, v: string): { k: number; rate: number; lnBase: Node } | null {
  g = strip(g);
  if (g.type === 'FunctionNode' && g.fn.name === 'exp') {
    const l = linearOf(g.args[0], v);
    return l && { k: l.a, rate: l.a, lnBase: cnst(1) };
  }
  if (!isOp(g, 'pow') || dependsOn(g.args[0], v)) return null;
  const l = linearOf(g.args[1], v);
  const a = evalConst(g.args[0]);
  if (!l || a === null || a <= 0 || a === 1) return null;
  const b = strip(g.args[0]);
  const isE = b.type === 'SymbolNode' && b.name === 'e';
  return { k: l.a, rate: l.a * (isE ? 1 : Math.log(a)), lnBase: isE ? cnst(1) : fnc('log', g.args[0]) };
}

interface TrigInfo {
  name: 'sin' | 'cos' | 'sinh' | 'cosh';
  u: Node;
  a: number;
  b: number;
}
function trigInfo(g: Node, v: string): TrigInfo | null {
  g = strip(g);
  if (g.type !== 'FunctionNode' || g.args.length !== 1) return null;
  const name = g.fn.name;
  if (name !== 'sin' && name !== 'cos' && name !== 'sinh' && name !== 'cosh') return null;
  const l = linearOf(g.args[0], v);
  return l && { name, u: g.args[0], a: l.a, b: l.b };
}

/** Signed node for P(x) * g, with rational content pulled out: (9x^2 - 2) sin(3x) / 27. */
function polyTimes(P: number[], g: Node, v: string, gFirst = false): Node | null {
  P = pClean(P);
  if (pIsZero(P)) return null;
  if (P.length === 1) return scale(g, P[0]);
  let c = 1;
  let prim = P;
  const ip = toIntPoly(P);
  if (ip && ip.prim.every((a) => babs(a) < 1_000_000_000n)) {
    c = Number(ip.cn) / Number(ip.cd);
    prim = ip.prim.map(Number);
  } else if (P[P.length - 1] < 0) {
    c = -1;
    prim = P.map((a) => -a);
  }
  const pn = polyNode(prim, sym(v));
  return scale(gFirst ? mul(g, pn) : mul(pn, g), c);
}

/** ∫ p(x) g(x) dx by tabular integration, g = e^(kx), a^(kx), sin, cos, sinh, cosh. */
function tabular(p: number[], g: Node, v: string): Node | null {
  const ex = expRate(g, v);
  if (ex && numVal(ex.lnBase) !== 1) {
    // a^(kx): keep ln(a) symbolic — a^u Σ (-1)^i p^(i) / (k ln a)^(i+1)
    let sum: Node = cnst(0);
    let d = p;
    for (let i = 0; !pIsZero(d); i++) {
      const term = scale(div(polyNode(pClean(d), sym(v)), pow(ex.lnBase, i + 1)), (i % 2 ? -1 : 1) / Math.pow(ex.k, i + 1));
      sum = add(sum, term);
      d = pDeriv(d);
    }
    return mul(g, sum);
  }
  if (ex) {
    // ∫ p e^(rx) = e^(rx) Σ (-1)^i p^(i) / r^(i+1)
    let Q: number[] = [0];
    let d = p;
    for (let i = 0; !pIsZero(d); i++) {
      Q = pAdd(Q, d.map((c) => ((i % 2 ? -1 : 1) * c) / Math.pow(ex.rate, i + 1)));
      d = pDeriv(d);
    }
    return polyTimes(Q, g, v, true) ?? cnst(0);
  }
  const t = trigInfo(g, v);
  if (!t) return null;
  const hyper = t.name === 'sinh' || t.name === 'cosh';
  // antiderivatives as [coefficient of cos/cosh, coefficient of sin/sinh]
  const step = ([c, s]: [number, number]): [number, number] => (hyper ? [s / t.a, c / t.a] : [-s / t.a, c / t.a]);
  let G: [number, number] = t.name === 'cos' || t.name === 'cosh' ? [1, 0] : [0, 1];
  let A: number[] = [0];
  let B: number[] = [0];
  let d = p;
  for (let i = 0; !pIsZero(d); i++) {
    G = step(G);
    const sg = i % 2 ? -1 : 1;
    A = pAdd(A, d.map((c) => sg * c * G[0]));
    B = pAdd(B, d.map((c) => sg * c * G[1]));
    d = pDeriv(d);
  }
  const terms: [number, Node | null][] = [
    [pDeg(pClean(A)), polyTimes(A, fnc(hyper ? 'cosh' : 'cos', t.u), v)],
    [pDeg(pClean(B)), polyTimes(B, fnc(hyper ? 'sinh' : 'sin', t.u), v)],
  ];
  terms.sort((m, n) => n[0] - m[0]);
  const parts = terms.map((q) => q[1]).filter((q): q is Node => q !== null);
  if (!parts.length) return cnst(0);
  return parts.length === 1 ? parts[0] : add(parts[0], parts[1]);
}

/** ∫ p(x) ln(ax+b) dx = P(x) ln(ax+b) − ∫ P(x)/(x − r) dx with P(r) = 0. */
function polyTimesLog(p: number[], g: Node, v: string): Node | null {
  g = strip(g);
  if (g.type !== 'FunctionNode' || g.fn.name !== 'log' || g.args.length !== 1) return null;
  const l = linearOf(g.args[0], v);
  if (!l) return null;
  const r = -l.b / l.a;
  let P = pInt(p);
  P = pAdd(P, [-pEval(P, r)]);
  const [Q] = pDivMod(P, [-r, 1]);
  const head = polyTimes(P, g, v);
  const tail = polyNode(pClean(pInt(Q)), sym(v));
  return head ? sub(head, tail) : neg(tail);
}

/** Rules for specific pairs of non-polynomial factors. */
function pairRule(f1: Factor, f2: Factor, v: string, depth: number): Node | null {
  if (f1.exp !== 1 || f2.exp !== 1) return null;
  const [g1, g2] = [strip(f1.base), strip(f2.base)];
  // e^(px) sin(qx), e^(px) cos(qx)
  for (const [e, s] of [
    [g1, g2],
    [g2, g1],
  ]) {
    const ex = expRate(e, v);
    const t = trigInfo(s, v);
    if (ex && t && (t.name === 'sin' || t.name === 'cos')) {
      const r = ex.rate;
      const k = t.a;
      const sinU = fnc('sin', t.u);
      const cosU = fnc('cos', t.u);
      const inner = t.name === 'sin' ? sub(scale(sinU, r), scale(cosU, k)) : add(scale(cosU, r), scale(sinU, k));
      return scale(mul(e, inner), 1 / (r * r + k * k));
    }
  }
  if (g1.type !== 'FunctionNode' || g2.type !== 'FunctionNode' || g1.args.length !== 1 || g2.args.length !== 1) return null;
  const n1 = g1.fn.name as string;
  const n2 = g2.fn.name as string;
  const sameArg = g1.args[0].toString() === g2.args[0].toString();
  const l1 = linearOf(g1.args[0], v);
  const l2 = linearOf(g2.args[0], v);
  if (!l1 || !l2) return null;
  if (sameArg) {
    const pair = new Set([n1, n2]);
    if (pair.has('sec') && pair.has('tan')) return scale(fnc('sec', g1.args[0]), 1 / l1.a);
    if (pair.has('csc') && pair.has('cot')) return scale(fnc('csc', g1.args[0]), -1 / l1.a);
    return null;
  }
  // product-to-sum for sin/cos with different linear arguments
  const trig = new Set(['sin', 'cos']);
  if (!trig.has(n1) || !trig.has(n2)) return null;
  const plus = linNode(l1.a + l2.a, l1.b + l2.b, v);
  const [s1, s2, ls] = n1 === 'sin' || n2 !== 'sin' ? [g1, g2, l1] : [g2, g1, l2];
  const lo = ls === l1 ? l2 : l1;
  const minus = linNode(ls.a - lo.a, ls.b - lo.b, v);
  let sum: Node;
  if (s1.fn.name === 'sin' && s2.fn.name === 'cos') sum = add(fnc('sin', plus), fnc('sin', minus));
  else if (s1.fn.name === 'sin') sum = sub(fnc('cos', minus), fnc('cos', plus));
  else sum = add(fnc('cos', minus), fnc('cos', plus));
  const r = integrate(sum, v, depth + 1);
  return r && scale(r, 0.5);
}

/** u-substitution: the integrand is k · f(g(x)) · g'(x) for one factor f(g). */
function uSub(factors: Factor[], v: string, depth: number): Node | null {
  const samples = [0.31, 0.73, 1.17, 1.61, 2.29, 0.47, 2.83, 1.93];
  for (let i = 0; i < factors.length; i++) {
    const F = factors[i];
    const base = strip(F.base);
    const cands: Node[] = [base];
    if (base.type === 'FunctionNode') cands.push(strip(base.args[0]));
    if (isOp(base, 'pow')) cands.push(strip(base.args[1]), strip(base.args[0]));
    for (const g of cands) {
      if (!dependsOn(g, v) || linearOf(g, v)) continue;
      if (g.type === 'SymbolNode') continue;
      let gp: Node;
      try {
        gp = M().derivative(g, v);
      } catch {
        continue;
      }
      const rest = productNode(factors.filter((_, j) => j !== i));
      const restCode = rest.compile();
      const gpCode = gp.compile();
      let k: number | null = null;
      let ok = true;
      let count = 0;
      for (const s of samples) {
        const a = evalAt(restCode, v, s);
        const b = evalAt(gpCode, v, s);
        if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b) < 1e-12) continue;
        const ratio = a / b;
        count++;
        if (k === null) k = ratio;
        else if (Math.abs(ratio - k) > 1e-9 * Math.max(1, Math.abs(k))) {
          ok = false;
          break;
        }
      }
      if (!ok || count < 3 || k === null || k === 0) continue;
      const key = g.toString();
      const t = sym(SUB_VAR);
      const f = fNode(F).transform((n: Node) => (n.toString() === key ? t : n));
      if (dependsOn(f, v)) continue;
      const r = integrate(f, SUB_VAR, depth + 1);
      if (!r) continue;
      const back = r.transform((n: Node) => (n.type === 'SymbolNode' && n.name === SUB_VAR ? g : n));
      return scale(back, k);
    }
  }
  return null;
}

/** ∫ 1/sqrt(A x² + B x + C) dx. */
function invSqrtQuadratic(p: number[], base: Node, v: string): Node | null {
  const [C, B, A] = p;
  const D = B * B - 4 * A * C;
  if (A < 0) {
    if (D <= 0) return null;
    const s = Math.sqrt(D);
    // asin(-(2Ax + B)/sqrt(D)) / sqrt(-A)
    const arg = toFraction(s, 10000, 1e-12) ? ratLin((-2 * A) / s, -B / s, v) : div(neg(linNode(2 * A, B, v)), fnc('sqrt', num(D)));
    return sqrtScale(fnc('asin', arg), -A);
  }
  // ln|2 sqrt(A) sqrt(q) + 2Ax + B| / sqrt(A); the argument is positive when D < 0
  const sa = Math.sqrt(A);
  const lg = (u: Node) => (D < 0 ? fnc('log', u) : logAbs(u));
  if (toFraction(sa, 10000, 1e-12)) return scale(lg(add(fnc('sqrt', base), linNode(sa, B / (2 * sa), v))), 1 / sa);
  const rad = mul(mul(cnst(2), fnc('sqrt', num(A))), fnc('sqrt', base));
  return sqrtScale(lg(add(rad, linNode(2 * A, B, v))), A);
}

/** node / sqrt(c), exact when sqrt(c) is rational. */
function sqrtScale(node: Node, c: number): Node {
  const s = Math.sqrt(c);
  if (toFraction(s, 10000, 1e-12)) return scale(node, 1 / s);
  return div(node, fnc('sqrt', num(c)));
}

/** ∫ n(x)/d(x) dx where d is a power of a linear factor or has degree ≤ 2. */
function integrateRational(nIn: number[], dIn: number[], v: string): Node | null {
  const n = pClean(nIn);
  const d = pClean(dIn);
  const x = sym(v);
  const k = pDeg(d);
  if (k < 0) return null;
  if (k === 0) return polyNode(pClean(pInt(n.map((c) => c / d[0]))), x);
  const lead = d[k];
  // d = lead (x − r)^k ?
  const r = -d[k - 1] / (k * lead);
  const pk = pPow([-r, 1], k).map((c) => c * lead);
  if (pk.every((c, i) => Math.abs(c - d[i]) <= 1e-9 * Math.max(1, Math.abs(d[i])))) {
    // L = q x − p with r = p/q (integer form when r is rational); x − r = L/q
    const fr = toFraction(r, 10000, 1e-12);
    const q = fr ? fr[1] : 1;
    const L = fr ? linNode(q, -fr[0], v) : linNode(1, -r, v);
    // polynomial part, then Taylor coefficients of the remainder around r
    const [Qp, Rp] = k <= pDeg(n) ? pDivMod(n, d) : [[0], n];
    let rem = pClean(Rp);
    const taylor: number[] = [];
    while (!pIsZero(rem)) {
      const [qq, rr] = pDivMod(rem, [-r, 1]);
      taylor.push(rr[0]);
      rem = pDeg(rem) >= 1 ? qq : [0];
    }
    let out: Node = pIsZero(Qp) ? cnst(0) : polyNode(pClean(pInt(Qp)), x);
    taylor.forEach((c, j) => {
      if (Math.abs(c) < 1e-14) return;
      const m = j - k; // c/lead · (x − r)^m = c/lead · L^m / q^m
      const coef = c / lead / Math.pow(q, m);
      const term = m === -1 ? scale(logAbs(L), coef * q) : scale(powSigned(L, m + 1), (coef * q) / (m + 1));
      out = add(out, term);
    });
    return out;
  }
  if (k !== 2) return partialFractions(n, d, v);
  // quadratic denominator: divide, then split remainder
  const [Q, R] = pDivMod(n, d);
  // scale denominator to a primitive integer form when possible
  const fr = d.map((c) => toFraction(c / lead, 10000, 1e-12));
  let A = d[2];
  let B = d[1];
  let C = d[0];
  let factor = 1;
  if (fr.every(Boolean)) {
    const den = fr.reduce((acc, f) => lcm(acc, f![1]), 1);
    factor = lead / den; // d = factor · (den·d/lead)
    [C, B, A] = d.map((c) => Math.round((c / lead) * den));
  }
  // remainder over (A x² + B x + C): p1 x + p0 with integrand R/(factor·(Ax²+Bx+C))
  const p1 = (R[1] ?? 0) / factor;
  const p0 = R[0] / factor;
  const quad = polyNode([C, B, A], x);
  const D = B * B - 4 * A * C;
  let out: Node = pDeg(Q) >= 0 && !pIsZero(Q) ? polyNode(pClean(pInt(Q)), x) : cnst(0);
  if (p1 !== 0) {
    const lnq = D < 0 && A > 0 ? fnc('log', quad) : logAbs(quad);
    out = add(out, scale(lnq, p1 / (2 * A)));
  }
  const K = p0 - (p1 * B) / (2 * A);
  if (Math.abs(K) > 1e-14) {
    if (D < 0) {
      const s = Math.sqrt(-D);
      const exact = toFraction(s, 10000, 1e-12);
      const arg = exact ? ratLin((2 * A) / s, B / s, v) : div(linNode(2 * A, B, v), fnc('sqrt', num(-D)));
      out = add(out, exact ? scale(fnc('atan', arg), (2 * K) / s) : scale(div(fnc('atan', arg), fnc('sqrt', num(-D))), 2 * K));
    } else if (D === 0) {
      // A (x + B/2A)^2 → −K / (A (x + B/2A))
      out = add(out, scale(pow(linNode(2 * A, B, v), -1), -2 * K));
    } else {
      const s = Math.sqrt(D);
      const exact = toFraction(s, 10000, 1e-12);
      if (exact) {
        const lin1 = primitiveLin(2 * A, B - s, v);
        const lin2 = primitiveLin(2 * A, B + s, v);
        out = add(out, scale(sub(logAbs(lin1), logAbs(lin2)), K / s));
      } else {
        const sq = fnc('sqrt', num(D));
        const lin = linNode(2 * A, B, v);
        const t = sub(logAbs(sub(lin, sq)), logAbs(add(lin, sq)));
        out = add(out, scale(div(t, sq), K));
      }
    }
  }
  return out;
}

/**
 * Partial fractions when the denominator splits over Q into linear factors
 * (any multiplicity) and at most one irreducible quadratic.
 */
function partialFractions(n: number[], d: number[], v: string): Node | null {
  const ip = toIntPoly(d);
  if (!ip) return null;
  let prim = ip.prim;
  let zero = 0;
  while (prim.length > 1 && prim[0] === 0n) {
    prim = prim.slice(1);
    zero++;
  }
  const { roots, rest } = rationalRoots(prim);
  if (rest.length - 1 > 2 || rest.length === 2) return null;
  const lin = roots.map((r) => ({ r: Number(r.p) / Number(r.q), m: r.mult }));
  if (zero) lin.unshift({ r: 0, m: zero });
  const quad = rest.length === 3 ? rest.map(Number) : null;
  const qm = quad ? quad.map((c) => c / quad[2]) : null;
  const lead = d[d.length - 1];
  const [Q, R0] = pDivMod(n, d);
  const R = R0.map((c) => c / lead);
  let dm: number[] = [1];
  for (const { r, m } of lin) dm = pMul(dm, pPow([-r, 1], m));
  if (qm) dm = pMul(dm, qm);
  const deg = dm.length - 1;
  const cols: number[][] = [];
  for (const { r, m } of lin) for (let j = 1; j <= m; j++) cols.push(pDivMod(dm, pPow([-r, 1], j))[0]);
  if (qm) {
    const base = pDivMod(dm, qm)[0];
    cols.push(pMul(base, [0, 1]), base);
  }
  if (cols.length !== deg) return null;
  const A = Array.from({ length: deg }, (_, i) => cols.map((c) => c[i] ?? 0));
  const b = Array.from({ length: deg }, (_, i) => R[i] ?? 0);
  const sol = solveLinear(A, b);
  if (sol.kind !== 'unique') return null;
  const coef = pClean(sol.x.concat(1)).slice(0, deg);
  while (coef.length < deg) coef.push(0);
  let out: Node = pIsZero(Q) ? cnst(0) : polyNode(pClean(pInt(Q)), sym(v));
  let idx = 0;
  for (const { r, m } of lin)
    for (let j = 1; j <= m; j++) {
      const c = coef[idx++];
      if (c === 0) continue;
      const t = integrateRational([c], pPow([-r, 1], j), v);
      if (!t) return null;
      out = add(out, t);
    }
  if (qm) {
    const [B, C] = [coef[idx], coef[idx + 1]];
    if (B !== 0 || C !== 0) {
      const t = integrateRational(pClean([C, B]), quad!.map((c) => c / quad![2]), v);
      if (!t) return null;
      out = add(out, t);
    }
  }
  return out;
}

function lcm(a: number, b: number): number {
  const g = (x: number, y: number): number => (y ? g(y, x % y) : x);
  return (a / g(a, b)) * b;
}

/** a x + b written as (p x + q) / m with integers when a, b are rational. */
function ratLin(a: number, b: number, v: string): Node {
  const fa = toFraction(a, 10000, 1e-12);
  const fb = toFraction(b, 10000, 1e-12);
  if (!fa || !fb) return linNode(a, b, v);
  const m = lcm(fa[1], fb[1]);
  return m === 1 ? linNode(a, b, v) : div(linNode(Math.round(a * m), Math.round(b * m), v), cnst(m));
}

/** a x + b scaled to coprime integers with positive leading coefficient (when rational). */
function primitiveLin(a: number, b: number, v: string): Node {
  const fa = toFraction(a, 10000, 1e-12);
  const fb = toFraction(b, 10000, 1e-12);
  if (fa && fb) {
    const den = lcm(fa[1], fb[1]);
    let ia = Math.round(a * den);
    let ib = Math.round(b * den);
    const g = (x: number, y: number): number => (y ? g(y, x % y) : x);
    const gg = Math.abs(g(Math.abs(ia), Math.abs(ib))) || 1;
    ia /= gg;
    ib /= gg;
    if (ia < 0) {
      ia = -ia;
      ib = -ib;
    }
    return linNode(ia, ib, v);
  }
  return linNode(a, b, v);
}

/* ------------------------------ finishing touches ------------------------------ */

/** Simplify with math.js, keeping constants like ln(2), sqrt(3) symbolic. */
function finalize(node: Node): Node {
  let best = node;
  try {
    const saved: Node[] = [];
    const prot = node.transform((n: Node) => {
      if (n.type === 'FunctionNode' && n.args.every((a: Node) => !dependsOnAny(a))) {
        saved.push(n);
        return sym(`__k${saved.length - 1}`);
      }
      return n;
    });
    const simp = M().simplify(prot);
    const restored = simp.transform((n: Node) => {
      const m = n.type === 'SymbolNode' && /^__k(\d+)$/.exec(n.name);
      return m ? saved[Number(m[1])] : n;
    });
    const tidy = tidyUp(restored);
    if (nodeSize(tidy) < 0.8 * nodeSize(node)) best = tidy;
  } catch {
    /* keep the unsimplified result */
  }
  return tidyUp(best);
}

function evalConstSafe(n: Node): number | null {
  return dependsOnAny(n) ? null : evalConst(n);
}

function dependsOnAny(n: Node): boolean {
  let found = false;
  n.traverse((c: Node) => {
    if (c.type === 'SymbolNode' && !['e', 'pi', 'E', 'PI', 'tau', 'phi'].includes(c.name)) found = true;
  });
  return found;
}

function tidyUp(node: Node): Node {
  return node.transform((n: Node) => {
    if (isOp(n, 'multiply') && n.args.length === 2) {
      if (numVal(n.args[1]) === -1) return neg(n.args[0]);
      if (numVal(n.args[0]) === -1) return neg(n.args[1]);
    }
    if (isOp(n, 'add') && n.args.length === 2 && isNeg(n.args[1])) return opn('-', 'subtract', [n.args[0], neg(n.args[1])]);
    if (isOp(n, 'unaryMinus') && isOp(strip(n.args[0]), 'divide')) {
      const d = strip(n.args[0]);
      return opn('/', 'divide', [neg(d.args[0]), d.args[1]]);
    }
    if (isOp(n, 'pow') && Math.abs((evalConstSafe(n.args[1]) ?? 0) - 0.5) < 1e-15) return fnc('sqrt', n.args[0]);
    return n;
  });
}

/** Check d/dx F ≈ f numerically wherever both are real and finite. */
function verifies(F: Node, f: Node, v: string): boolean {
  const Fc = F.compile();
  const fc = f.compile();
  const pts = [-2.37, -1.41, -0.63, -0.21, 0.29, 0.83, 1.37, 2.11, 3.03];
  for (const p of pts) {
    const y = evalAt(fc, v, p);
    if (!Number.isFinite(y)) continue;
    const h = 1e-4 * Math.max(1, Math.abs(p));
    const vals = [-2, -1, 1, 2].map((k) => evalAt(Fc, v, p + k * h));
    if (!vals.every(Number.isFinite)) continue;
    const d = (vals[0] - 8 * vals[1] + 8 * vals[2] - vals[3]) / (12 * h);
    const scaleTol = Math.max(1, Math.abs(y), ...vals.map((t) => Math.abs(t) * 1e-3));
    if (Math.abs(d - y) > 1e-6 * scaleTol) return false;
  }
  return true;
}

export interface CasResult {
  text: string;
  tex: string;
}

/**
 * Symbolic indefinite integral of expr with respect to variable, or null when
 * no rule applies. The "+ C" is left to the caller.
 */
export function antiderivative(expr: string, variable = 'x'): CasResult | null {
  try {
    if (!expr.trim()) return null;
    const integrand = toMathjsLogs(M().parse(prepare(expr)));
    const raw = integrate(integrand, variable, 0);
    if (!raw) return null;
    const res = finalize(raw);
    if (!verifies(res, integrand, variable)) return null;
    const out = fromMathjsLogs(res);
    return { text: out.toString({ implicit: 'hide', parenthesis: 'auto' }), tex: expressionTex(getCalc(), out) };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------------ */
/*                           exact integer polynomials                            */
/* ------------------------------------------------------------------------------ */

const babs = (a: bigint) => (a < 0n ? -a : a);
function bgcd(a: bigint, b: bigint): bigint {
  a = babs(a);
  b = babs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}
const btrim = (c: bigint[]) => {
  const r = c.slice();
  while (r.length > 1 && r[r.length - 1] === 0n) r.pop();
  return r;
};

/** Rational coefficients → content (num/den) · primitive integer polynomial with positive lead. */
function toIntPoly(c: number[]): { cn: bigint; cd: bigint; prim: bigint[] } | null {
  const fr: [bigint, bigint][] = [];
  for (const x of c) {
    if (Number.isInteger(x)) {
      if (Math.abs(x) > Number.MAX_SAFE_INTEGER) return null;
      fr.push([BigInt(x), 1n]);
      continue;
    }
    const f = toFraction(x, MAX_DEN, 1e-12);
    if (!f) return null;
    fr.push([BigInt(f[0]), BigInt(f[1])]);
  }
  let L = 1n;
  for (const [, d] of fr) L = (L / bgcd(L, d)) * d;
  const ints = fr.map(([n, d]) => (n * L) / d);
  let G = 0n;
  for (const a of ints) G = bgcd(G, a);
  if (G === 0n) return null;
  let prim = btrim(ints.map((a) => a / G));
  let cn = G;
  if (prim[prim.length - 1] < 0n) {
    prim = prim.map((a) => -a);
    cn = -cn;
  }
  const g = bgcd(cn, L);
  return { cn: cn / g, cd: L / g, prim };
}

/** Divide a by (q x − p) exactly; null when not exact. */
function bDivLinear(a: bigint[], p: bigint, q: bigint): bigint[] | null {
  const n = a.length - 1;
  const b: bigint[] = new Array(n).fill(0n);
  let carry = a[n];
  for (let k = n; k >= 1; k--) {
    if (carry % q !== 0n) return null;
    b[k - 1] = carry / q;
    carry = a[k - 1] + p * b[k - 1];
  }
  return carry === 0n ? b : null;
}

function divisors(n: bigint): bigint[] | null {
  n = babs(n);
  if (n === 0n || n > 1_000_000_000_000n) return null;
  const N = Number(n);
  const out: number[] = [];
  for (let i = 1; i * i <= N; i++) {
    if (N % i === 0) {
      out.push(i);
      if (i * i !== N) out.push(N / i);
    }
  }
  return out.map((d) => BigInt(d));
}

interface RatRoot {
  p: bigint;
  q: bigint;
  mult: number;
}

/** Rational roots (with multiplicity) of a primitive integer polynomial with a0 ≠ 0. */
function rationalRoots(prim: bigint[]): { roots: RatRoot[]; rest: bigint[] } {
  let rest = prim.slice();
  const roots: RatRoot[] = [];
  const P = divisors(rest[0]);
  const Q = divisors(rest[rest.length - 1]);
  if (!P || !Q) return { roots, rest };
  const seen = new Set<string>();
  for (const q of Q) {
    for (const p0 of P) {
      if (bgcd(p0, q) !== 1n) continue;
      for (const p of [p0, -p0]) {
        const key = `${p}/${q}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let mult = 0;
        while (rest.length > 1) {
          const d = bDivLinear(rest, p, q);
          if (!d) break;
          rest = d;
          mult++;
        }
        if (mult) roots.push({ p, q, mult });
      }
    }
  }
  return { roots, rest };
}

function bigPolyText(c: bigint[], v: string, tex: boolean): string {
  let s = '';
  for (let k = c.length - 1; k >= 0; k--) {
    const a = c[k];
    if (a === 0n) continue;
    const abs = babs(a);
    const coef = abs === 1n && k > 0 ? '' : abs.toString();
    const pw = k === 0 ? '' : k === 1 ? v : tex ? `${v}^{${k}}` : `${v}^${k}`;
    const term = coef + pw;
    if (!s) s = (a < 0n ? '-' : '') + term;
    else s += a < 0n ? ` - ${term}` : ` + ${term}`;
  }
  return s || '0';
}

export interface FactorResult extends CasResult {
  /** Each factor as a standalone expression, e.g. ['2', 'x', 'x - 1', '(x + 1)^2', 'x^2 + 1']. */
  factors: string[];
}

/**
 * Factor a one-variable polynomial with rational coefficients over Q.
 * Irreducible quadratics and unfactorable higher-degree parts are left as-is.
 */
export function factorPolynomial(expr: string, variable = 'x'): FactorResult | null {
  let coeffs: number[] | null;
  try {
    coeffs = polyCoeffs(toMathjsLogs(M().parse(prepare(expr))), variable);
  } catch {
    return null;
  }
  if (!coeffs) return null;
  coeffs = trim(coeffs.map((c) => (Math.abs(c) < 1e-14 ? 0 : c)));
  if (coeffs.length < 2) return null;
  const ip = toIntPoly(coeffs);
  if (!ip) return null;
  let prim = ip.prim;
  let zeroMult = 0;
  while (prim.length > 1 && prim[0] === 0n) {
    prim = prim.slice(1);
    zeroMult++;
  }
  const { roots, rest } = rationalRoots(prim);
  roots.sort((a, b) => {
    const ra = Math.abs(Number(a.p) / Number(a.q));
    const rb = Math.abs(Number(b.p) / Number(b.q));
    return ra - rb || Number(b.p > 0n) - Number(a.p > 0n);
  });

  interface Piece {
    text: string;
    tex: string;
    multi: boolean;
    mult: number;
  }
  const pieces: Piece[] = [];
  if (zeroMult) pieces.push({ text: variable, tex: variable, multi: false, mult: zeroMult });
  for (const r of roots) {
    const lin = [-r.p, r.q];
    pieces.push({ text: bigPolyText(lin, variable, false), tex: bigPolyText(lin, variable, true), multi: true, mult: r.mult });
  }
  if (rest.length > 1) pieces.push({ text: bigPolyText(rest, variable, false), tex: bigPolyText(rest, variable, true), multi: true, mult: 1 });

  const { cn, cd } = ip;
  const contentText = cd === 1n ? cn.toString() : `${cn}/${cd}`;
  const contentTex = cd === 1n ? cn.toString() : `${cn < 0n ? '-' : ''}\\frac{${babs(cn)}}{${cd}}`;
  const single = pieces.length === 1 && babs(cn) === 1n && cd === 1n;

  const factors: string[] = [];
  if (!(cn === 1n && cd === 1n)) factors.push(contentText);
  let text = '';
  let tex = '';
  for (const pc of pieces) {
    const wrapT = pc.multi && (!single || pc.mult > 1) ? `(${pc.text})` : pc.text;
    const wrapX = pc.multi && (!single || pc.mult > 1) ? `\\left(${pc.tex}\\right)` : pc.tex;
    text += pc.mult > 1 ? `${wrapT}^${pc.mult}` : wrapT;
    tex += pc.mult > 1 ? `${wrapX}^{${pc.mult}}` : wrapX;
    factors.push(pc.mult > 1 ? `${pc.multi ? `(${pc.text})` : pc.text}^${pc.mult}` : pc.text);
  }
  let preT = '';
  let preX = '';
  if (cd === 1n) {
    if (cn === -1n) [preT, preX] = ['-', '-'];
    else if (cn !== 1n) [preT, preX] = [contentText, contentTex];
  } else {
    preT = cn < 0n ? `-(${babs(cn)}/${cd})` : `(${contentText})`;
    preX = contentTex;
  }
  return { text: preT + text, tex: preX + tex, factors };
}

/* ------------------------------------------------------------------------------ */
/*                                  inequalities                                  */
/* ------------------------------------------------------------------------------ */

type Interval = [number, number, boolean, boolean];

export interface InequalityResult {
  /** Solution set as [lo, hi, loClosed, hiClosed] (±Infinity allowed; [a, a, true, true] is a single point). */
  intervals: Interval[];
  text: string;
  tex: string;
  /** True when every real number satisfies the inequality. */
  all: boolean;
  /** True when no real number does. */
  none: boolean;
}

interface Root {
  x: number;
  text: string;
  tex: string;
}

function labelFor(x: number): { text: string; tex: string } {
  if (Number.isInteger(x)) return { text: String(x), tex: String(x) };
  const ex = exactForm(x);
  if (ex) return { text: ex.text, tex: ex.tex };
  const s = String(Number(x.toPrecision(10)));
  return { text: s, tex: s };
}

/** Distinct real roots of a polynomial (lowest degree first). */
function realRoots(c: number[]): Root[] {
  c = trim(c.map((x) => (Math.abs(x) < 1e-14 ? 0 : x)));
  if (c.length < 2) return [];
  const out: Root[] = [];
  let numeric = c;
  const ip = toIntPoly(c);
  if (ip) {
    let prim = ip.prim;
    if (prim[0] === 0n) {
      out.push({ x: 0, text: '0', tex: '0' });
      while (prim.length > 1 && prim[0] === 0n) prim = prim.slice(1);
    }
    const { roots, rest } = rationalRoots(prim);
    for (const r of roots) {
      const x = Number(r.p) / Number(r.q);
      const sg = r.p < 0n ? '-' : '';
      const ap = babs(r.p);
      out.push(
        r.q === 1n
          ? { x, text: r.p.toString(), tex: r.p.toString() }
          : { x, text: `${sg}${ap}/${r.q}`, tex: `${sg}\\frac{${ap}}{${r.q}}` },
      );
    }
    numeric = squareFreeFloat(rest);
  }
  if (numeric.length > 1) {
    const rs = polyRoots(numeric.slice().reverse());
    for (const r of rs) {
      if (Math.abs(r.im) > 1e-7 * Math.max(1, Math.abs(r.re))) continue;
      if (out.some((o) => Math.abs(o.x - r.re) <= 1e-9 * Math.max(1, Math.abs(r.re)))) continue;
      out.push({ x: r.re, ...labelFor(r.re) });
    }
  }
  return out.sort((a, b) => a.x - b.x);
}

/** Square-free part of an integer polynomial (exact), as floats. */
function squareFreeFloat(p: bigint[]): number[] {
  if (p.length <= 2) return p.map(Number);
  const d = btrim(p.slice(1).map((a, i) => a * BigInt(i + 1)));
  const g = bPolyGcd(p, d);
  if (g.length <= 1) return p.map(Number);
  const q = bDivExact(p, g);
  return (q ?? p).map(Number);
}

function bPrimitive(a: bigint[]): bigint[] {
  let g = 0n;
  for (const c of a) g = bgcd(g, c);
  if (g === 0n) return a;
  const r = a.map((c) => c / g);
  return r[r.length - 1] < 0n ? r.map((c) => -c) : r;
}

/** Pseudo-remainder of a by b. */
function bPrem(a: bigint[], b: bigint[]): bigint[] {
  let r = a.slice();
  const db = b.length - 1;
  const lb = b[db];
  while (r.length - 1 >= db && !(r.length === 1 && r[0] === 0n)) {
    const dr = r.length - 1;
    const lr = r[dr];
    const next = r.map((c) => c * lb);
    for (let j = 0; j <= db; j++) next[dr - db + j] -= lr * b[j];
    r = btrim(next);
    if (r.length - 1 === dr) break; // safety; should not happen
  }
  return r;
}

function bPolyGcd(a: bigint[], b: bigint[]): bigint[] {
  a = bPrimitive(a);
  b = bPrimitive(b);
  while (!(b.length === 1 && b[0] === 0n)) {
    if (b.length === 1) return [1n];
    const r = bPrem(a, b);
    a = b;
    b = r.length === 1 && r[0] === 0n ? r : bPrimitive(r);
  }
  return bPrimitive(a);
}

function bDivExact(a: bigint[], b: bigint[]): bigint[] | null {
  const r = a.slice();
  const db = b.length - 1;
  const q: bigint[] = new Array(Math.max(1, r.length - db)).fill(0n);
  for (let i = r.length - 1; i >= db; i--) {
    if (r[i] % b[db] !== 0n) return null;
    const c = r[i] / b[db];
    q[i - db] = c;
    for (let j = 0; j <= db; j++) r[i - db + j] -= c * b[j];
  }
  return r.every((c) => c === 0n) ? q : null;
}

interface Condition {
  n: number[];
  d: number[];
  op: 'smaller' | 'larger' | 'smallerEq' | 'largerEq';
  numRoots: Root[];
  denRoots: Root[];
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

function satisfies(c: Condition, x: number, exact?: Root): boolean {
  if (c.denRoots.some((r) => near(r.x, x))) return false;
  let val: number;
  if (exact && c.numRoots.some((r) => near(r.x, x))) val = 0;
  else val = pEval(c.n, x) / pEval(c.d, x);
  if (!Number.isFinite(val)) return false;
  if (Math.abs(val) < 1e-12 && c.numRoots.some((r) => near(r.x, x))) val = 0;
  switch (c.op) {
    case 'smaller':
      return val < 0;
    case 'larger':
      return val > 0;
    case 'smallerEq':
      return val <= 0;
    case 'largerEq':
      return val >= 0;
  }
}

const OPS: Record<string, Condition['op']> = { smaller: 'smaller', larger: 'larger', smallerEq: 'smallerEq', largerEq: 'largerEq' };

/**
 * Solve a polynomial or rational inequality (<, >, <=, >=, ≤, ≥; chained forms
 * like 1 < x^2 < 4 are also accepted). Throws for unsupported input.
 */
export function solveInequality(expr: string, variable = 'x'): InequalityResult {
  let node: Node;
  try {
    node = strip(M().parse(prepare(expr)));
  } catch {
    throw new Error('Could not read the inequality');
  }
  const pairs: [Node, Node, string][] = [];
  if (node.type === 'OperatorNode' && OPS[node.fn]) pairs.push([node.args[0], node.args[1], node.fn]);
  else if (node.type === 'RelationalNode') node.conditionals.forEach((c: string, i: number) => pairs.push([node.params[i], node.params[i + 1], c]));
  if (!pairs.length || pairs.some((p) => !OPS[p[2]])) throw new Error('Enter an inequality using <, >, ≤ or ≥, e.g. x^2 - 3x + 2 > 0');

  const conds: Condition[] = pairs.map(([l, r, op]) => {
    const diff = toMathjsLogs(opn('-', 'subtract', [l, r]));
    const rat = ratCoeffs(diff, variable);
    if (!rat) throw new Error('Only polynomial and rational inequalities are supported');
    const n = trim(rat.n.map((c) => (Math.abs(c) < 1e-14 ? 0 : c)));
    const d = trim(rat.d.map((c) => (Math.abs(c) < 1e-14 ? 0 : c)));
    if (pIsZero(d)) throw new Error('Division by zero');
    return { n, d, op: OPS[op], numRoots: realRoots(n), denRoots: realRoots(d) };
  });

  // all boundaries, sorted and de-duplicated
  const bounds: Root[] = [];
  for (const c of conds)
    for (const r of [...c.numRoots, ...c.denRoots]) {
      const existing = bounds.find((b) => near(b.x, r.x));
      if (!existing) bounds.push(r);
      else if (existing.text.length > r.text.length && /^-?[\d/]+$/.test(r.text)) Object.assign(existing, r);
    }
  bounds.sort((a, b) => a.x - b.x);

  const test = (x: number, exact?: Root) => conds.every((c) => satisfies(c, x, exact));
  // pieces: segment, point, segment, …, segment
  type Piece = { lo: number; hi: number; point: boolean; inc: boolean; lo_r?: Root; hi_r?: Root };
  const pieces: Piece[] = [];
  const mid = (a: number, b: number) => (a === -Infinity ? (b === Infinity ? 0 : b - 1 - Math.abs(b)) : b === Infinity ? a + 1 + Math.abs(a) : (a + b) / 2);
  let prev = -Infinity;
  for (const b of bounds) {
    pieces.push({ lo: prev, hi: b.x, point: false, inc: test(mid(prev, b.x)) });
    pieces.push({ lo: b.x, hi: b.x, point: true, inc: test(b.x, b) });
    prev = b.x;
  }
  pieces.push({ lo: prev, hi: Infinity, point: false, inc: test(mid(prev, Infinity)) });

  const intervals: Interval[] = [];
  let cur: Interval | null = null;
  for (const p of pieces) {
    if (p.inc) {
      if (!cur) cur = [p.lo, p.hi, p.point, p.point];
      else {
        cur[1] = p.hi;
        cur[3] = p.point;
      }
    } else if (cur) {
      intervals.push(cur);
      cur = null;
    }
  }
  if (cur) intervals.push(cur);
  for (const iv of intervals) {
    if (!Number.isFinite(iv[0])) iv[2] = false;
    if (!Number.isFinite(iv[1])) iv[3] = false;
  }

  const all = intervals.length === 1 && intervals[0][0] === -Infinity && intervals[0][1] === Infinity;
  const none = intervals.length === 0;
  const label = (x: number) => bounds.find((b) => b.x === x) ?? { x, ...labelFor(x) };
  const v = variable;
  let text: string;
  let tex: string;
  if (all) [text, tex] = [`all real ${v}`, `\\text{all real } ${v}`];
  else if (none) [text, tex] = ['no solution', '\\text{no solution}'];
  else if (
    intervals.length >= 2 &&
    intervals[0][0] === -Infinity &&
    intervals[intervals.length - 1][1] === Infinity &&
    intervals.every((iv, i) => i === 0 || (iv[0] === intervals[i - 1][1] && !iv[2] && !intervals[i - 1][3]))
  ) {
    const holes = intervals.slice(1).map((iv) => label(iv[0]));
    text = holes.map((h) => `${v} ≠ ${h.text}`).join(' and ');
    tex = holes.map((h) => `${v} \\ne ${h.tex}`).join(' \\text{ and } ');
  } else {
    const t: string[] = [];
    const x: string[] = [];
    for (const [lo, hi, lc, hc] of intervals) {
      const L = label(lo);
      const H = label(hi);
      if (lo === hi) {
        t.push(`${v} = ${L.text}`);
        x.push(`${v} = ${L.tex}`);
      } else if (lo === -Infinity) {
        t.push(`${v} ${hc ? '≤' : '<'} ${H.text}`);
        x.push(`${v} ${hc ? '\\le' : '<'} ${H.tex}`);
      } else if (hi === Infinity) {
        t.push(`${v} ${lc ? '≥' : '>'} ${L.text}`);
        x.push(`${v} ${lc ? '\\ge' : '>'} ${L.tex}`);
      } else {
        t.push(`${L.text} ${lc ? '≤' : '<'} ${v} ${hc ? '≤' : '<'} ${H.text}`);
        x.push(`${L.tex} ${lc ? '\\le' : '<'} ${v} ${hc ? '\\le' : '<'} ${H.tex}`);
      }
    }
    text = t.join(' or ');
    tex = x.join(' \\text{ or } ');
  }
  return { intervals, text, tex, all, none };
}
