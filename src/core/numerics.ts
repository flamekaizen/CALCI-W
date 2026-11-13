/**
 * Numerical methods used across Calci. All algorithms are implemented from
 * standard textbook descriptions (Lanczos gamma, Lentz continued fractions,
 * Gauss-Kronrod quadrature, Ridders differentiation, Brent's method).
 */

export type Fn1 = (x: number) => number;

const EPS = 2.220446049250313e-16;

/* ------------------------------ special functions ------------------------------ */

const LANCZOS_G = 7;
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function gamma(x: number): number {
  if (Number.isInteger(x)) {
    if (x <= 0) return NaN;
    if (x <= 171) {
      let r = 1;
      for (let i = 2; i < x; i++) r *= i;
      return r;
    }
    return Infinity;
  }
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  if (x > 171.6) return Infinity;
  x -= 1;
  let a = LANCZOS[0];
  const t = x + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i] / (x + i);
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}

export function lgamma(x: number): number {
  if (x <= 0 && Number.isInteger(x)) return Infinity;
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = LANCZOS[0];
  const t = x + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

export function factorial(n: number): number {
  return gamma(n + 1);
}

export function lbeta(a: number, b: number): number {
  return lgamma(a) + lgamma(b) - lgamma(a + b);
}

export function erf(x: number): number {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? NaN : Math.sign(x);
  const ax = Math.abs(x);
  if (ax < 2.5) {
    let sum = x;
    let term = x;
    const x2 = x * x;
    for (let n = 1; n < 200; n++) {
      term *= -x2 / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    return (2 / Math.sqrt(Math.PI)) * sum;
  }
  return Math.sign(x) * (1 - erfc(ax));
}

export function erfc(x: number): number {
  if (x < 2.5) return 1 - erf(x);
  const tiny = 1e-300;
  let f = x;
  let C = x;
  let D = 0;
  for (let n = 1; n < 300; n++) {
    const an = n / 2;
    D = x + an * D;
    D = Math.abs(D) < tiny ? tiny : D;
    C = x + an / C;
    C = Math.abs(C) < tiny ? tiny : C;
    D = 1 / D;
    const delta = C * D;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / (f * Math.sqrt(Math.PI));
}

/** Regularised lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (!Number.isFinite(x)) return 1;
  if (x < a + 1) {
    let sum = 1 / a;
    let del = sum;
    let ap = a;
    for (let n = 0; n < 1000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
    }
    return Math.min(1, sum * Math.exp(-x + a * Math.log(x) - lgamma(a)));
  }
  return 1 - gammaQcf(a, x);
}

function gammaQcf(a: number, x: number): number {
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}

/** Regularised incomplete beta I_x(a, b). */
export function betaI(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(-lbeta(a, b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(x, a, b)) / a;
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}

function betacf(x: number, a: number, b: number): number {
  const tiny = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 1000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return h;
}

/* ---------------------------------- calculus ---------------------------------- */

const GK_X = [
  0.991455371120812639206854697526329, 0.949107912342758524526189684047851, 0.864864423359769072789712788640926,
  0.741531185599394439863864773280788, 0.58608723546769113029414483825873, 0.405845151377397166906606412076961,
  0.207784955007898467600689403773245, 0,
];
const GK_WK = [
  0.02293532201052922496373200805897, 0.063092092629978553290700663189204, 0.104790010322250183839876322541518,
  0.140653259715525918745189590510238, 0.16900472663926790282658342659855, 0.190350578064785409913256402421014,
  0.204432940075298892414161999234649, 0.209482141084727828012999174891714,
];
const GK_WG = [0.129484966168869693270611432679082, 0.27970539148927666790146777142378, 0.381830050505118944950369775488975, 0.417959183673469387755102040816327];

function gk15(f: Fn1, a: number, b: number): [number, number] {
  const c = 0.5 * (a + b);
  const h = 0.5 * (b - a);
  const fc = f(c);
  let k = fc * GK_WK[7];
  let g = fc * GK_WG[3];
  for (let j = 0; j < 7; j++) {
    const dx = h * GK_X[j];
    const f1 = f(c - dx);
    const f2 = f(c + dx);
    k += GK_WK[j] * (f1 + f2);
    if (j % 2 === 1) g += GK_WG[(j - 1) / 2] * (f1 + f2);
  }
  return [k * h, Math.abs((k - g) * h)];
}

export interface IntegralResult {
  value: number;
  error: number;
  evaluations: number;
}

/** Adaptive Gauss-Kronrod (G7/K15) quadrature, supports infinite bounds. */
export function integrate(f: Fn1, a: number, b: number, tol = 1e-12, maxDepth = 50): IntegralResult {
  if (a === b) return { value: 0, error: 0, evaluations: 0 };
  if (a > b) {
    const r = integrate(f, b, a, tol, maxDepth);
    return { ...r, value: -r.value };
  }
  let g: Fn1 = f;
  let lo = a;
  let hi = b;
  if (!Number.isFinite(a) && !Number.isFinite(b)) {
    g = (t) => {
      const x = t / (1 - t * t);
      return (f(x) * (1 + t * t)) / ((1 - t * t) * (1 - t * t));
    };
    lo = -1;
    hi = 1;
  } else if (!Number.isFinite(b)) {
    g = (t) => f(a + t / (1 - t)) / ((1 - t) * (1 - t));
    lo = 0;
    hi = 1;
  } else if (!Number.isFinite(a)) {
    g = (t) => f(b - (1 - t) / t) / (t * t);
    lo = 0;
    hi = 1;
  }
  let evaluations = 0;
  const safe: Fn1 = (x) => {
    evaluations++;
    const y = g(x);
    return Number.isFinite(y) ? y : 0;
  };
  const stack: [number, number, number, number, number][] = [];
  const [v0, e0] = gk15(safe, lo, hi);
  stack.push([lo, hi, v0, e0, 0]);
  let total = 0;
  let err = 0;
  let iterations = 0;
  const globalTol = Math.max(tol * Math.abs(v0), 1e-300);
  while (stack.length) {
    const [x0, x1, v, e, d] = stack.pop()!;
    iterations++;
    const width = (x1 - x0) / (hi - lo);
    const local = Math.max(tol * Math.abs(v), globalTol * width, 1e-15 * width);
    if (e <= local || d >= maxDepth || iterations > 20000 || x1 - x0 < 1e-15 * Math.max(1, Math.abs(x0))) {
      total += v;
      err += e;
      continue;
    }
    const m = 0.5 * (x0 + x1);
    const [va, ea] = gk15(safe, x0, m);
    const [vb, eb] = gk15(safe, m, x1);
    stack.push([x0, m, va, ea, d + 1], [m, x1, vb, eb, d + 1]);
  }
  return { value: total, error: err, evaluations };
}

/** Ridders' method: derivative with Richardson extrapolation. */
export function derivative(f: Fn1, x: number, order = 1): number {
  if (order === 0) return f(x);
  if (order > 1) {
    const h = Math.max(1e-3, Math.abs(x) * 1e-3) * Math.pow(2, -(order - 1));
    return (derivative(f, x + h, order - 1) - derivative(f, x - h, order - 1)) / (2 * h);
  }
  const CON = 1.4;
  const CON2 = CON * CON;
  const NTAB = 10;
  let hh = 0.1 * Math.max(1, Math.abs(x));
  const a: number[][] = Array.from({ length: NTAB }, () => new Array(NTAB).fill(0));
  a[0][0] = (f(x + hh) - f(x - hh)) / (2 * hh);
  let err = Infinity;
  let ans = a[0][0];
  for (let i = 1; i < NTAB; i++) {
    hh /= CON;
    a[0][i] = (f(x + hh) - f(x - hh)) / (2 * hh);
    let fac = CON2;
    for (let j = 1; j <= i; j++) {
      a[j][i] = (a[j - 1][i] * fac - a[j - 1][i - 1]) / (fac - 1);
      fac *= CON2;
      const errt = Math.max(Math.abs(a[j][i] - a[j - 1][i]), Math.abs(a[j][i] - a[j - 1][i - 1]));
      if (errt <= err) {
        err = errt;
        ans = a[j][i];
      }
    }
    if (Math.abs(a[i][i] - a[i - 1][i - 1]) >= 2 * err) break;
  }
  return ans;
}

/** Brent's method on a bracketing interval. Returns NaN if not bracketed. */
export function brent(f: Fn1, a: number, b: number, tol = 1e-15, maxIter = 200): number {
  let fa = f(a);
  let fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (!(fa * fb < 0)) return NaN;
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  for (let i = 0; i < maxIter; i++) {
    if (fb * fc > 0) {
      c = a;
      fc = fa;
      d = e = b - a;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const tol1 = 2 * EPS * Math.abs(b) + 0.5 * tol;
    const xm = 0.5 * (c - b);
    if (Math.abs(xm) <= tol1 || fb === 0) return b;
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2 * xm * s;
        q = 1 - s;
      } else {
        const qq = fa / fc;
        const r = fb / fc;
        p = s * (2 * xm * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);
      if (2 * p < Math.min(3 * xm * q - Math.abs(tol1 * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = xm;
        e = d;
      }
    } else {
      d = xm;
      e = d;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol1 ? d : xm > 0 ? tol1 : -tol1;
    fb = f(b);
  }
  return b;
}

/** Newton's method with numeric derivative; NaN on failure. */
export function newton(f: Fn1, x0: number, maxIter = 100): number {
  let x = x0;
  for (let i = 0; i < maxIter; i++) {
    const fx = f(x);
    if (!Number.isFinite(fx)) return NaN;
    if (Math.abs(fx) < 1e-15) return x;
    const h = 1e-7 * Math.max(1, Math.abs(x));
    const d = (f(x + h) - f(x - h)) / (2 * h);
    if (!Number.isFinite(d) || d === 0) return NaN;
    const nx = x - fx / d;
    if (Math.abs(nx - x) < 1e-15 * Math.max(1, Math.abs(x))) return nx;
    x = nx;
  }
  return Math.abs(f(x)) < 1e-9 ? x : NaN;
}

/** Golden-section minimiser on [a,b]. */
export function minimize(f: Fn1, a: number, b: number, tol = 1e-12): number {
  const gr = (Math.sqrt(5) - 1) / 2;
  let c = b - gr * (b - a);
  let d = a + gr * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < 200 && Math.abs(b - a) > tol * (1 + Math.abs(a) + Math.abs(b)); i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - gr * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + gr * (b - a);
      fd = f(d);
    }
  }
  return (a + b) / 2;
}

/** Find every root of f in [a, b] by scanning for sign changes and touching minima. */
export function findRoots(f: Fn1, a: number, b: number, samples = 2000): number[] {
  const roots: number[] = [];
  const step = (b - a) / samples;
  const scale = Math.max(1e-300, Math.abs(b - a));
  const push = (r: number) => {
    if (!Number.isFinite(r)) return;
    if (roots.some((q) => Math.abs(q - r) < 1e-9 * Math.max(1, Math.abs(r)) + scale * 1e-12)) return;
    roots.push(r);
  };
  let x0 = a;
  let f0 = f(x0);
  let fPrev = NaN;
  for (let i = 1; i <= samples; i++) {
    const x1 = a + i * step;
    const f1 = f(x1);
    if (f0 === 0) push(x0);
    else if (Number.isFinite(f0) && Number.isFinite(f1) && f0 * f1 < 0) {
      const r = brent(f, x0, x1);
      const fr = f(r);
      // reject poles (sign change through infinity)
      if (Number.isFinite(fr) && Math.abs(fr) < 1e-6 * Math.max(1, Math.abs(f0), Math.abs(f1))) push(r);
    } else if (
      Number.isFinite(fPrev) && Number.isFinite(f0) && Number.isFinite(f1) &&
      Math.abs(f0) < Math.abs(fPrev) && Math.abs(f0) < Math.abs(f1) &&
      Math.sign(fPrev) === Math.sign(f0) && Math.sign(f1) === Math.sign(f0)
    ) {
      const m = minimize((x) => Math.abs(f(x)), x0 - step, x1);
      if (Math.abs(f(m)) < 1e-10) push(m);
    }
    fPrev = f0;
    x0 = x1;
    f0 = f1;
  }
  if (f0 === 0) push(x0);
  return roots.sort((p, q) => p - q);
}

export type LimitResult = { value: number; exists: boolean; left: number; right: number };

/** Richardson extrapolation for a sequence sampled at h, h/r, h/r^2, ... */
function richardson(vals: number[], r: number): number {
  const t = vals.slice();
  for (let k = 1; k < t.length; k++) {
    const p = Math.pow(r, k);
    for (let i = t.length - 1; i >= k; i--) t[i] = (p * t[i] - t[i - 1]) / (p - 1);
  }
  return t[t.length - 1];
}

function oneSided(f: Fn1, a: number, dir: 1 | -1): number {
  const vals: number[] = [];
  const r = 4;
  for (let k = 2; k <= 9; k++) {
    const h = Math.pow(r, -k) * Math.max(1, Math.abs(a));
    vals.push(f(a + dir * h));
  }
  const last = vals.slice(-5);
  if (last.some((v) => !Number.isFinite(v))) {
    const end = last[last.length - 1];
    if (Math.abs(end) === Infinity) return end;
    return NaN;
  }
  const mag = last.map(Math.abs);
  if (mag[4] > 1e7 && mag[4] > mag[3] && mag[3] > mag[2] && mag[2] > mag[1]) return Math.sign(last[4]) * Infinity;
  // oscillation check (e.g. sin(1/x))
  const d1 = Math.abs(last[4] - last[3]);
  const d0 = Math.abs(last[3] - last[2]);
  if (d1 > 1e-3 * Math.max(1, Math.abs(last[4])) && d1 > 0.5 * d0) return NaN;
  const ex = richardson(last.slice(-3), r);
  const plain = last[4];
  return Number.isFinite(ex) && Math.abs(ex - plain) < 1e-3 * Math.max(1, Math.abs(plain)) ? ex : plain;
}

/** Numeric limit of f at a (supports +/-Infinity). */
export function limit(f: Fn1, a: number, side: 'both' | 'left' | 'right' = 'both'): LimitResult {
  if (a === Infinity || a === -Infinity) {
    const g: Fn1 = (t) => f(1 / t);
    const v = oneSided(g, 0, a > 0 ? 1 : -1);
    return { value: clean(v), exists: !Number.isNaN(v), left: v, right: v };
  }
  const left = oneSided(f, a, -1);
  const right = oneSided(f, a, 1);
  if (side === 'left') return { value: clean(left), exists: !Number.isNaN(left), left, right };
  if (side === 'right') return { value: clean(right), exists: !Number.isNaN(right), left, right };
  const same = left === right || Math.abs(left - right) <= 1e-6 * Math.max(1, Math.abs(left), Math.abs(right));
  return {
    value: same ? clean(Number.isFinite(left) ? (left + right) / 2 : left) : NaN,
    exists: same && !Number.isNaN(left),
    left,
    right,
  };
}

/** Round away floating-point noise to a sensible precision. */
export function clean(v: number, digits = 12): number {
  if (!Number.isFinite(v) || v === 0) return v;
  const r = Number(v.toPrecision(digits));
  if (Math.abs(r - Math.round(r)) < 1e-9 * Math.max(1, Math.abs(r))) return Math.round(r);
  return r;
}

/** Sum f(i) for integer i in [a, b]; b may be Infinity. */
export function series(f: Fn1, a: number, b: number): { value: number; converged: boolean; terms: number } {
  let sum = 0;
  let comp = 0;
  let small = 0;
  const maxTerms = 5_000_000;
  let n = 0;
  for (let i = Math.ceil(a); i <= b; i++) {
    const t = f(i);
    if (!Number.isFinite(t)) return { value: t, converged: false, terms: n };
    const y = t - comp;
    const s = sum + y;
    comp = s - sum - y;
    sum = s;
    n++;
    if (b === Infinity) {
      if (Math.abs(t) < 1e-17 * Math.max(1, Math.abs(sum))) small++;
      else small = 0;
      if (small > 20) return { value: sum, converged: true, terms: n };
    }
    if (n > maxTerms) return { value: sum, converged: false, terms: n };
  }
  return { value: sum, converged: true, terms: n };
}

export function product(f: Fn1, a: number, b: number): number {
  let p = 1;
  let n = 0;
  for (let i = Math.ceil(a); i <= b && n < 1_000_000; i++, n++) {
    const t = f(i);
    p *= t;
    if (p === 0 || !Number.isFinite(p)) break;
    if (b === Infinity && Math.abs(t - 1) < 1e-16) break;
  }
  return p;
}

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}
