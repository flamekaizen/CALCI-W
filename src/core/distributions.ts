/**
 * Probability distributions. Exposes both structured distribution objects
 * (for the Statistics UI / API) and calculator-style named functions
 * (normalcdf, invNorm, binompdf, ...) that are importable into expressions.
 */
import { betaI, erfc, gammaP, lgamma, brent } from './numerics.js';

export interface Distribution {
  id: string;
  name: string;
  discrete: boolean;
  params: { key: string; label: string; default: number; min?: number; integer?: boolean }[];
  pdf: (x: number, p: number[]) => number;
  cdf: (x: number, p: number[]) => number;
  inv?: (q: number, p: number[]) => number;
  mean: (p: number[]) => number;
  variance: (p: number[]) => number;
  support: (p: number[]) => [number, number];
}

const SQRT2 = Math.SQRT2;
const SQRT2PI = Math.sqrt(2 * Math.PI);

export function normPdf(x: number, mu = 0, sigma = 1): number {
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * SQRT2PI);
}
export function normCdf(x: number, mu = 0, sigma = 1): number {
  return 0.5 * erfc(-(x - mu) / (sigma * SQRT2));
}

/** Acklam's rational approximation refined with one Halley step. */
export function normInv(p: number, mu = 0, sigma = 1): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let x: number;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pl) {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const e = normCdf(x) - p;
  const u = e * SQRT2PI * Math.exp((x * x) / 2);
  x = x - u / (1 + (x * u) / 2);
  return mu + sigma * x;
}

export function tPdf(x: number, df: number): number {
  return Math.exp(lgamma((df + 1) / 2) - lgamma(df / 2) - 0.5 * Math.log(df * Math.PI) - ((df + 1) / 2) * Math.log(1 + (x * x) / df));
}
export function tCdf(x: number, df: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  const p = 0.5 * betaI(df / (df + x * x), df / 2, 0.5);
  return x > 0 ? 1 - p : p;
}
export function chi2Pdf(x: number, k: number): number {
  if (x < 0) return 0;
  if (x === 0) return k === 2 ? 0.5 : k < 2 ? Infinity : 0;
  return Math.exp((k / 2 - 1) * Math.log(x) - x / 2 - (k / 2) * Math.LN2 - lgamma(k / 2));
}
export function chi2Cdf(x: number, k: number): number {
  return x <= 0 ? 0 : gammaP(k / 2, x / 2);
}
export function fPdf(x: number, d1: number, d2: number): number {
  if (x < 0) return 0;
  if (x === 0) return d1 === 2 ? 1 : d1 < 2 ? Infinity : 0;
  const ln = 0.5 * (d1 * Math.log(d1 * x) + d2 * Math.log(d2) - (d1 + d2) * Math.log(d1 * x + d2)) - Math.log(x) - (lgamma(d1 / 2) + lgamma(d2 / 2) - lgamma((d1 + d2) / 2));
  return Math.exp(ln);
}
export function fCdf(x: number, d1: number, d2: number): number {
  return x <= 0 ? 0 : betaI((d1 * x) / (d1 * x + d2), d1 / 2, d2 / 2);
}
function lchoose(n: number, k: number) {
  return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
}
export function binomPmf(k: number, n: number, p: number): number {
  if (k < 0 || k > n || !Number.isInteger(k)) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return Math.exp(lchoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}
export function binomCdf(k: number, n: number, p: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  return 1 - betaI(p, Math.floor(k) + 1, n - Math.floor(k));
}
export function poissonPmf(k: number, lambda: number): number {
  if (k < 0 || !Number.isInteger(k)) return 0;
  return Math.exp(k * Math.log(lambda) - lambda - lgamma(k + 1));
}
export function poissonCdf(k: number, lambda: number): number {
  if (k < 0) return 0;
  return 1 - gammaP(Math.floor(k) + 1, lambda);
}
export function geomPmf(k: number, p: number): number {
  return k < 1 || !Number.isInteger(k) ? 0 : Math.pow(1 - p, k - 1) * p;
}
export function geomCdf(k: number, p: number): number {
  return k < 1 ? 0 : 1 - Math.pow(1 - p, Math.floor(k));
}

/** Generic inverse CDF by bracketing + Brent. */
export function invertCdf(cdf: (x: number) => number, q: number, lo: number, hi: number, discrete = false): number {
  if (q <= 0) return lo;
  if (q >= 1) return hi;
  let a = Number.isFinite(lo) ? lo : -1;
  let b = Number.isFinite(hi) ? hi : 1;
  let guard = 0;
  while (!Number.isFinite(lo) && cdf(a) > q && guard++ < 200) a *= 2;
  guard = 0;
  while (!Number.isFinite(hi) && cdf(b) < q && guard++ < 200) b = b <= 0 ? 1 : b * 2;
  if (discrete) {
    a = Math.floor(a);
    b = Math.ceil(b);
    while (b - a > 1) {
      const m = Math.floor((a + b) / 2);
      if (cdf(m) >= q) b = m;
      else a = m;
    }
    return cdf(a) >= q ? a : b;
  }
  const r = brent((x) => cdf(x) - q, a, b, 1e-14);
  return r;
}

export const DISTRIBUTIONS: Distribution[] = [
  {
    id: 'normal',
    name: 'Normal',
    discrete: false,
    params: [
      { key: 'mu', label: 'μ (mean)', default: 0 },
      { key: 'sigma', label: 'σ (std. dev.)', default: 1, min: 0 },
    ],
    pdf: (x, [m, s]) => normPdf(x, m, s),
    cdf: (x, [m, s]) => normCdf(x, m, s),
    inv: (q, [m, s]) => normInv(q, m, s),
    mean: ([m]) => m,
    variance: ([, s]) => s * s,
    support: ([m, s]) => [m - 4 * s, m + 4 * s],
  },
  {
    id: 't',
    name: 'Student t',
    discrete: false,
    params: [{ key: 'df', label: 'Degrees of freedom', default: 10, min: 0 }],
    pdf: (x, [df]) => tPdf(x, df),
    cdf: (x, [df]) => tCdf(x, df),
    inv: (q, [df]) => invertCdf((x) => tCdf(x, df), q, -Infinity, Infinity),
    mean: ([df]) => (df > 1 ? 0 : NaN),
    variance: ([df]) => (df > 2 ? df / (df - 2) : df > 1 ? Infinity : NaN),
    support: ([df]) => {
      const w = df > 2 ? 4 * Math.sqrt(df / (df - 2)) : 8;
      return [-w, w];
    },
  },
  {
    id: 'chi2',
    name: 'Chi-square χ²',
    discrete: false,
    params: [{ key: 'k', label: 'Degrees of freedom', default: 4, min: 0 }],
    pdf: (x, [k]) => chi2Pdf(x, k),
    cdf: (x, [k]) => chi2Cdf(x, k),
    inv: (q, [k]) => invertCdf((x) => chi2Cdf(x, k), q, 0, Infinity),
    mean: ([k]) => k,
    variance: ([k]) => 2 * k,
    support: ([k]) => [0, k + 5 * Math.sqrt(2 * k)],
  },
  {
    id: 'f',
    name: 'F (Fisher)',
    discrete: false,
    params: [
      { key: 'd1', label: 'Numerator df', default: 5, min: 0 },
      { key: 'd2', label: 'Denominator df', default: 10, min: 0 },
    ],
    pdf: (x, [a, b]) => fPdf(x, a, b),
    cdf: (x, [a, b]) => fCdf(x, a, b),
    inv: (q, [a, b]) => invertCdf((x) => fCdf(x, a, b), q, 0, Infinity),
    mean: ([, b]) => (b > 2 ? b / (b - 2) : NaN),
    variance: ([a, b]) => (b > 4 ? (2 * b * b * (a + b - 2)) / (a * (b - 2) * (b - 2) * (b - 4)) : NaN),
    support: ([a, b]) => [0, Math.max(5, invertCdf((x) => fCdf(x, a, b), 0.995, 0, Infinity))],
  },
  {
    id: 'exponential',
    name: 'Exponential',
    discrete: false,
    params: [{ key: 'lambda', label: 'λ (rate)', default: 1, min: 0 }],
    pdf: (x, [l]) => (x < 0 ? 0 : l * Math.exp(-l * x)),
    cdf: (x, [l]) => (x < 0 ? 0 : 1 - Math.exp(-l * x)),
    inv: (q, [l]) => -Math.log(1 - q) / l,
    mean: ([l]) => 1 / l,
    variance: ([l]) => 1 / (l * l),
    support: ([l]) => [0, 6 / l],
  },
  {
    id: 'uniform',
    name: 'Uniform',
    discrete: false,
    params: [
      { key: 'a', label: 'a (min)', default: 0 },
      { key: 'b', label: 'b (max)', default: 1 },
    ],
    pdf: (x, [a, b]) => (x < a || x > b ? 0 : 1 / (b - a)),
    cdf: (x, [a, b]) => (x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a)),
    inv: (q, [a, b]) => a + q * (b - a),
    mean: ([a, b]) => (a + b) / 2,
    variance: ([a, b]) => ((b - a) * (b - a)) / 12,
    support: ([a, b]) => [a - 0.2 * (b - a), b + 0.2 * (b - a)],
  },
  {
    id: 'binomial',
    name: 'Binomial',
    discrete: true,
    params: [
      { key: 'n', label: 'n (trials)', default: 20, min: 0, integer: true },
      { key: 'p', label: 'p (success)', default: 0.5, min: 0 },
    ],
    pdf: (x, [n, p]) => binomPmf(x, n, p),
    cdf: (x, [n, p]) => binomCdf(Math.floor(x), n, p),
    inv: (q, [n, p]) => invertCdf((x) => binomCdf(x, n, p), q, 0, n, true),
    mean: ([n, p]) => n * p,
    variance: ([n, p]) => n * p * (1 - p),
    support: ([n]) => [0, n],
  },
  {
    id: 'poisson',
    name: 'Poisson',
    discrete: true,
    params: [{ key: 'lambda', label: 'λ (mean)', default: 4, min: 0 }],
    pdf: (x, [l]) => poissonPmf(x, l),
    cdf: (x, [l]) => poissonCdf(Math.floor(x), l),
    inv: (q, [l]) => invertCdf((x) => poissonCdf(x, l), q, 0, Infinity, true),
    mean: ([l]) => l,
    variance: ([l]) => l,
    support: ([l]) => [0, Math.ceil(l + 5 * Math.sqrt(l) + 3)],
  },
  {
    id: 'geometric',
    name: 'Geometric',
    discrete: true,
    params: [{ key: 'p', label: 'p (success)', default: 0.3, min: 0 }],
    pdf: (x, [p]) => geomPmf(x, p),
    cdf: (x, [p]) => geomCdf(x, p),
    inv: (q, [p]) => invertCdf((x) => geomCdf(x, p), q, 1, Infinity, true),
    mean: ([p]) => 1 / p,
    variance: ([p]) => (1 - p) / (p * p),
    support: ([p]) => [1, Math.ceil(Math.log(0.001) / Math.log(1 - p)) + 1],
  },
];

/** Calculator-style functions, importable into expressions. */
export const distributions = {
  normalpdf: (x: number, m = 0, s = 1) => normPdf(x, m, s),
  normalcdf: (lo: number, hi: number, m = 0, s = 1) => normCdf(hi, m, s) - normCdf(lo, m, s),
  invNorm: (p: number, m = 0, s = 1) => normInv(p, m, s),
  tpdf: (x: number, df: number) => tPdf(x, df),
  tcdf: (lo: number, hi: number, df: number) => tCdf(hi, df) - tCdf(lo, df),
  invT: (p: number, df: number) => invertCdf((x) => tCdf(x, df), p, -Infinity, Infinity),
  chi2pdf: (x: number, k: number) => chi2Pdf(x, k),
  chi2cdf: (lo: number, hi: number, k: number) => chi2Cdf(hi, k) - chi2Cdf(lo, k),
  fpdf: (x: number, a: number, b: number) => fPdf(x, a, b),
  fcdf: (lo: number, hi: number, a: number, b: number) => fCdf(hi, a, b) - fCdf(lo, a, b),
  binompdf: (n: number, p: number, k: number) => binomPmf(k, n, p),
  binomcdf: (n: number, p: number, k: number) => binomCdf(k, n, p),
  poissonpdf: (l: number, k: number) => poissonPmf(k, l),
  poissoncdf: (l: number, k: number) => poissonCdf(k, l),
  geometpdf: (p: number, k: number) => geomPmf(k, p),
  geometcdf: (p: number, k: number) => geomCdf(k, p),
};
