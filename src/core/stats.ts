/**
 * Statistics: descriptive statistics, regression models, hypothesis tests
 * and confidence intervals.
 */
import { normCdf, normInv, tCdf, chi2Cdf, invertCdf } from './distributions.js';
import { solveLinear } from './solver.js';
import { clean } from './numerics.js';

export interface Descriptive {
  n: number;
  sum: number;
  sumSq: number;
  mean: number;
  median: number;
  modes: number[];
  min: number;
  max: number;
  range: number;
  q1: number;
  q3: number;
  iqr: number;
  variancePop: number;
  varianceSample: number;
  sdPop: number;
  sdSample: number;
  sem: number;
  skewness: number;
  kurtosis: number;
  geometricMean: number;
  harmonicMean: number;
  cv: number;
}

function medianSorted(s: number[]): number {
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Expand values with optional integer frequencies. */
export function expand(values: number[], freq?: number[]): number[] {
  if (!freq) return values.filter(Number.isFinite);
  const out: number[] = [];
  values.forEach((v, i) => {
    const f = Math.max(0, Math.round(freq[i] ?? 1));
    if (Number.isFinite(v)) for (let k = 0; k < f; k++) out.push(v);
  });
  return out;
}

export function describe(valuesIn: number[], freq?: number[]): Descriptive {
  const x = expand(valuesIn, freq);
  const n = x.length;
  const s = x.slice().sort((a, b) => a - b);
  const sum = x.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const sumSq = x.reduce((a, b) => a + b * b, 0);
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const v of x) {
    const d = v - mean;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  const variancePop = m2 / n;
  const varianceSample = n > 1 ? m2 / (n - 1) : NaN;
  // quartiles: median of halves (exclusive), the convention used by most handheld calculators
  const half = Math.floor(n / 2);
  const lower = s.slice(0, half);
  const upper = s.slice(n % 2 ? half + 1 : half);
  const q1 = n > 1 ? medianSorted(lower) : s[0];
  const q3 = n > 1 ? medianSorted(upper) : s[0];
  const counts = new Map<number, number>();
  for (const v of x) counts.set(v, (counts.get(v) ?? 0) + 1);
  const maxCount = Math.max(0, ...counts.values());
  const modes = maxCount > 1 ? [...counts].filter(([, c]) => c === maxCount).map(([v]) => v).sort((a, b) => a - b) : [];
  const allPos = x.every((v) => v > 0);
  const sdPop = Math.sqrt(variancePop);
  const sdSample = Math.sqrt(varianceSample);
  return {
    n,
    sum,
    sumSq,
    mean,
    median: medianSorted(s),
    modes,
    min: s[0],
    max: s[n - 1],
    range: s[n - 1] - s[0],
    q1,
    q3,
    iqr: q3 - q1,
    variancePop,
    varianceSample,
    sdPop,
    sdSample,
    sem: sdSample / Math.sqrt(n),
    skewness: n > 2 ? (m3 / n) / Math.pow(variancePop, 1.5) : NaN,
    kurtosis: n > 3 ? (m4 / n) / (variancePop * variancePop) - 3 : NaN,
    geometricMean: allPos ? Math.exp(x.reduce((a, b) => a + Math.log(b), 0) / n) : NaN,
    harmonicMean: allPos ? n / x.reduce((a, b) => a + 1 / b, 0) : NaN,
    cv: sdSample / mean,
  };
}

/** Percentile with linear interpolation (p in [0, 100]). */
export function percentile(values: number[], p: number): number {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

export function histogram(values: number[], bins?: number): { x0: number; x1: number; count: number }[] {
  const s = values.filter(Number.isFinite);
  if (!s.length) return [];
  const min = Math.min(...s);
  const max = Math.max(...s);
  const k = bins ?? Math.max(1, Math.ceil(Math.log2(s.length) + 1));
  const w = (max - min) / k || 1;
  const out = Array.from({ length: k }, (_, i) => ({ x0: min + i * w, x1: min + (i + 1) * w, count: 0 }));
  for (const v of s) out[Math.min(k - 1, Math.floor((v - min) / w))].count++;
  return out;
}

/* --------------------------------- regression --------------------------------- */

export type RegressionModel = 'linear' | 'quadratic' | 'cubic' | 'quartic' | 'exponential' | 'logarithmic' | 'power' | 'logistic' | 'sinusoidal';

export const REGRESSION_MODELS: { id: RegressionModel; label: string; form: string }[] = [
  { id: 'linear', label: 'Linear', form: 'y = a·x + b' },
  { id: 'quadratic', label: 'Quadratic', form: 'y = a·x² + b·x + c' },
  { id: 'cubic', label: 'Cubic', form: 'y = a·x³ + b·x² + c·x + d' },
  { id: 'quartic', label: 'Quartic', form: 'y = a·x⁴ + … + e' },
  { id: 'exponential', label: 'Exponential', form: 'y = a·bˣ' },
  { id: 'logarithmic', label: 'Logarithmic', form: 'y = a + b·ln x' },
  { id: 'power', label: 'Power', form: 'y = a·xᵇ' },
  { id: 'logistic', label: 'Logistic', form: 'y = c / (1 + a·e^(−b·x))' },
  { id: 'sinusoidal', label: 'Sinusoidal', form: 'y = a·sin(b·x + c) + d' },
];

export interface Regression {
  model: RegressionModel;
  params: Record<string, number>;
  r2: number;
  r?: number;
  equation: string;
  /** Expression usable in the graphing calculator, in terms of x. */
  expression: string;
  predict: (x: number) => number;
  residuals: number[];
  n: number;
}

function polyFit(x: number[], y: number[], degree: number): number[] {
  // least squares via normal equations on centred/scaled x for stability
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const sx = Math.max(1e-12, Math.sqrt(x.reduce((a, b) => a + (b - mx) ** 2, 0) / n));
  const u = x.map((v) => (v - mx) / sx);
  const m = degree + 1;
  const A = Array.from({ length: m }, () => new Array(m).fill(0));
  const B = new Array(m).fill(0);
  for (let i = 0; i < n; i++) {
    const pw = [1];
    for (let k = 1; k < 2 * m; k++) pw.push(pw[k - 1] * u[i]);
    for (let r = 0; r < m; r++) {
      B[r] += pw[r] * y[i];
      for (let c = 0; c < m; c++) A[r][c] += pw[r + c];
    }
  }
  const sol = solveLinear(A, B);
  if (sol.kind !== 'unique') throw new Error('Not enough distinct points for this model');
  // c(u) = sum g_k u^k with u = (x - mx)/sx  ->  convert to coefficients in x (ascending)
  const g = sol.x;
  const out = new Array(m).fill(0);
  for (let k = 0; k < m; k++) {
    // (x - mx)^k / sx^k expanded
    for (let j = 0; j <= k; j++) {
      const binom = choose(k, j);
      out[j] += (g[k] * binom * Math.pow(-mx, k - j)) / Math.pow(sx, k);
    }
  }
  return out; // ascending: c0 + c1 x + ...
}

function choose(n: number, k: number) {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

function rSquared(y: number[], yhat: number[]) {
  const my = y.reduce((a, b) => a + b, 0) / y.length;
  let ssr = 0;
  let sst = 0;
  y.forEach((v, i) => {
    ssr += (v - yhat[i]) ** 2;
    sst += (v - my) ** 2;
  });
  return sst === 0 ? 1 : 1 - ssr / sst;
}

const fmt = (v: number) => {
  const c = clean(v, 8);
  return String(c);
};
const signed = (v: number) => (v < 0 ? ` - ${fmt(-v)}` : ` + ${fmt(v)}`);

/** Fit a regression model to paired data. */
export function regress(xIn: number[], yIn: number[], model: RegressionModel): Regression {
  const pairs = xIn.map((x, i) => [x, yIn[i]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  const x = pairs.map((p) => p[0]);
  const y = pairs.map((p) => p[1]);
  const n = x.length;
  if (n < 2) throw new Error('Need at least two data points');
  let predict: (x: number) => number;
  let params: Record<string, number>;
  let equation: string;
  let expression: string;
  switch (model) {
    case 'linear':
    case 'quadratic':
    case 'cubic':
    case 'quartic': {
      const deg = { linear: 1, quadratic: 2, cubic: 3, quartic: 4 }[model];
      if (n < deg + 1) throw new Error(`Need at least ${deg + 1} points`);
      const c = polyFit(x, y, deg);
      const names = ['a', 'b', 'c', 'd', 'e'];
      const desc = c.slice().reverse();
      params = Object.fromEntries(desc.map((v, i) => [names[i], clean(v, 12)]));
      predict = (t) => c.reduce((s, v, k) => s + v * Math.pow(t, k), 0);
      const terms = desc.map((v, i) => {
        const p = deg - i;
        const xs = p === 0 ? '' : p === 1 ? 'x' : `x^${p}`;
        return { v, xs };
      });
      expression = terms.map((t, i) => (i === 0 ? `${fmt(t.v)}${t.xs ? `*${t.xs}` : ''}` : `${signed(t.v)}${t.xs ? `*${t.xs}` : ''}`)).join('');
      equation = `y = ${expression.replace(/\*/g, '')}`;
      break;
    }
    case 'exponential': {
      if (y.some((v) => v <= 0)) throw new Error('Exponential regression needs y > 0');
      const c = polyFit(x, y.map(Math.log), 1);
      const a = Math.exp(c[0]);
      const b = Math.exp(c[1]);
      params = { a: clean(a, 12), b: clean(b, 12) };
      predict = (t) => a * Math.pow(b, t);
      expression = `${fmt(a)}*${fmt(b)}^x`;
      equation = `y = ${fmt(a)}·${fmt(b)}^x`;
      break;
    }
    case 'logarithmic': {
      if (x.some((v) => v <= 0)) throw new Error('Logarithmic regression needs x > 0');
      const c = polyFit(x.map(Math.log), y, 1);
      params = { a: clean(c[0], 12), b: clean(c[1], 12) };
      predict = (t) => c[0] + c[1] * Math.log(t);
      expression = `${fmt(c[0])}${signed(c[1])}*ln(x)`;
      equation = `y = ${fmt(c[0])}${signed(c[1])}·ln x`;
      break;
    }
    case 'power': {
      if (x.some((v) => v <= 0) || y.some((v) => v <= 0)) throw new Error('Power regression needs x > 0 and y > 0');
      const c = polyFit(x.map(Math.log), y.map(Math.log), 1);
      const a = Math.exp(c[0]);
      const b = c[1];
      params = { a: clean(a, 12), b: clean(b, 12) };
      predict = (t) => a * Math.pow(t, b);
      expression = `${fmt(a)}*x^${b < 0 ? `(${fmt(b)})` : fmt(b)}`;
      equation = `y = ${fmt(a)}·x^${fmt(b)}`;
      break;
    }
    case 'logistic': {
      const fit = gaussNewton(
        x, y,
        (t, [a, b, c]) => c / (1 + a * Math.exp(-b * t)),
        initLogistic(x, y),
      );
      const [a, b, c] = fit;
      params = { a: clean(a, 10), b: clean(b, 10), c: clean(c, 10) };
      predict = (t) => c / (1 + a * Math.exp(-b * t));
      expression = `${fmt(c)}/(1 + ${fmt(a)}*e^(-${fmt(b)}*x))`;
      equation = `y = ${fmt(c)} / (1 + ${fmt(a)}·e^(−${fmt(b)}x))`;
      break;
    }
    case 'sinusoidal': {
      const fit = gaussNewton(x, y, (t, [a, b, c, d]) => a * Math.sin(b * t + c) + d, initSine(x, y));
      const [a, b, c, d] = fit;
      params = { a: clean(a, 10), b: clean(b, 10), c: clean(c, 10), d: clean(d, 10) };
      predict = (t) => a * Math.sin(b * t + c) + d;
      expression = `${fmt(a)}*sin(${fmt(b)}*x${signed(c)})${signed(d)}`;
      equation = `y = ${fmt(a)}·sin(${fmt(b)}x${signed(c)})${signed(d)}`;
      break;
    }
    default:
      throw new Error('Unknown model');
  }
  const yhat = x.map(predict);
  const r2 = clean(rSquared(y, yhat), 12);
  const res: Regression = { model, params, r2, equation, expression, predict, residuals: y.map((v, i) => v - yhat[i]), n };
  if (model === 'linear') res.r = clean(Math.sign(params.a) * Math.sqrt(Math.max(0, r2)), 12);
  return res;
}

function initLogistic(x: number[], y: number[]): number[] {
  const c = Math.max(...y) * 1.05;
  const y0 = y[0] > 0 ? y[0] : c / 10;
  const a = Math.max(1e-6, c / y0 - 1);
  const xr = Math.max(...x) - Math.min(...x) || 1;
  return [a, 4 / xr, c];
}

function initSine(x: number[], y: number[]): number[] {
  const my = y.reduce((s, v) => s + v, 0) / y.length;
  const amp = (Math.max(...y) - Math.min(...y)) / 2 || 1;
  // estimate period from mean crossings
  const order = x.map((v, i) => [v, y[i]]).sort((p, q) => p[0] - q[0]);
  const crossings: number[] = [];
  for (let i = 1; i < order.length; i++) if ((order[i - 1][1] - my) * (order[i][1] - my) < 0) crossings.push(order[i][0]);
  let period = (Math.max(...x) - Math.min(...x)) || 2 * Math.PI;
  if (crossings.length >= 2) period = (2 * (crossings[crossings.length - 1] - crossings[0])) / (crossings.length - 1);
  return [amp, (2 * Math.PI) / period, 0, my];
}

/** Levenberg-Marquardt style damped Gauss-Newton. */
function gaussNewton(x: number[], y: number[], f: (t: number, p: number[]) => number, p0: number[]): number[] {
  let p = p0.slice();
  let lambda = 1e-3;
  const sse = (q: number[]) => x.reduce((s, t, i) => s + (y[i] - f(t, q)) ** 2, 0);
  let cur = sse(p);
  for (let iter = 0; iter < 200; iter++) {
    const m = p.length;
    const JTJ = Array.from({ length: m }, () => new Array(m).fill(0));
    const JTr = new Array(m).fill(0);
    for (let i = 0; i < x.length; i++) {
      const r = y[i] - f(x[i], p);
      const J = p.map((v, k) => {
        const h = 1e-7 * Math.max(1, Math.abs(v));
        const q = p.slice();
        q[k] += h;
        return (f(x[i], q) - f(x[i], p)) / h;
      });
      for (let a = 0; a < m; a++) {
        JTr[a] += J[a] * r;
        for (let b = 0; b < m; b++) JTJ[a][b] += J[a] * J[b];
      }
    }
    let improved = false;
    for (let tries = 0; tries < 10; tries++) {
      const A = JTJ.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) : v)));
      const sol = solveLinear(A, JTr);
      if (sol.kind !== 'unique') {
        lambda *= 10;
        continue;
      }
      const q = p.map((v, k) => v + sol.x[k]);
      const s = sse(q);
      if (Number.isFinite(s) && s < cur) {
        const done = Math.abs(cur - s) < 1e-14 * Math.max(1, cur);
        p = q;
        cur = s;
        lambda = Math.max(lambda / 10, 1e-12);
        improved = true;
        if (done) return p;
        break;
      }
      lambda *= 10;
    }
    if (!improved) break;
  }
  return p;
}

/** Pearson correlation coefficient. */
export function correlation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  const mx = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = y.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

/* ------------------------------ tests & intervals ------------------------------ */

export type Tail = 'two' | 'left' | 'right';

export interface TestResult {
  statistic: number;
  statName: 'z' | 't' | 'χ²';
  p: number;
  df?: number;
  estimate?: number;
  se?: number;
  rejectAt05: boolean;
  details: Record<string, number>;
}

function pFromZ(z: number, tail: Tail) {
  if (tail === 'left') return normCdf(z);
  if (tail === 'right') return 1 - normCdf(z);
  return 2 * (1 - normCdf(Math.abs(z)));
}
function pFromT(t: number, df: number, tail: Tail) {
  if (tail === 'left') return tCdf(t, df);
  if (tail === 'right') return 1 - tCdf(t, df);
  return 2 * (1 - tCdf(Math.abs(t), df));
}
const done = (r: Omit<TestResult, 'rejectAt05'>): TestResult => ({ ...r, rejectAt05: r.p < 0.05 });

export function zTest(mean: number, sigma: number, n: number, mu0: number, tail: Tail = 'two'): TestResult {
  const se = sigma / Math.sqrt(n);
  const z = (mean - mu0) / se;
  return done({ statistic: z, statName: 'z', p: pFromZ(z, tail), se, estimate: mean, details: { mean, sigma, n, mu0 } });
}

export function tTest(mean: number, sd: number, n: number, mu0: number, tail: Tail = 'two'): TestResult {
  const se = sd / Math.sqrt(n);
  const t = (mean - mu0) / se;
  const df = n - 1;
  return done({ statistic: t, statName: 't', p: pFromT(t, df, tail), df, se, estimate: mean, details: { mean, sd, n, mu0 } });
}

export function twoSampleT(m1: number, s1: number, n1: number, m2: number, s2: number, n2: number, tail: Tail = 'two', pooled = false): TestResult {
  let se: number;
  let df: number;
  if (pooled) {
    const sp2 = ((n1 - 1) * s1 * s1 + (n2 - 1) * s2 * s2) / (n1 + n2 - 2);
    se = Math.sqrt(sp2 * (1 / n1 + 1 / n2));
    df = n1 + n2 - 2;
  } else {
    const v1 = (s1 * s1) / n1;
    const v2 = (s2 * s2) / n2;
    se = Math.sqrt(v1 + v2);
    df = (v1 + v2) ** 2 / ((v1 * v1) / (n1 - 1) + (v2 * v2) / (n2 - 1));
  }
  const t = (m1 - m2) / se;
  return done({ statistic: t, statName: 't', p: pFromT(t, df, tail), df, se, estimate: m1 - m2, details: { m1, s1, n1, m2, s2, n2 } });
}

export function onePropZ(successes: number, n: number, p0: number, tail: Tail = 'two'): TestResult {
  const phat = successes / n;
  const se = Math.sqrt((p0 * (1 - p0)) / n);
  const z = (phat - p0) / se;
  return done({ statistic: z, statName: 'z', p: pFromZ(z, tail), se, estimate: phat, details: { phat, n, p0 } });
}

export function twoPropZ(x1: number, n1: number, x2: number, n2: number, tail: Tail = 'two'): TestResult {
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const pp = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pp * (1 - pp) * (1 / n1 + 1 / n2));
  const z = (p1 - p2) / se;
  return done({ statistic: z, statName: 'z', p: pFromZ(z, tail), se, estimate: p1 - p2, details: { p1, p2, pooled: pp } });
}

export function chiSquareGOF(observed: number[], expected: number[]): TestResult {
  let chi = 0;
  observed.forEach((o, i) => (chi += (o - expected[i]) ** 2 / expected[i]));
  const df = observed.length - 1;
  return done({ statistic: chi, statName: 'χ²', p: 1 - chi2Cdf(chi, df), df, details: { categories: observed.length } });
}

export function chiSquareIndependence(table: number[][]): TestResult {
  const rows = table.length;
  const cols = table[0].length;
  const rt = table.map((r) => r.reduce((a, b) => a + b, 0));
  const ct = table[0].map((_, j) => table.reduce((a, r) => a + r[j], 0));
  const total = rt.reduce((a, b) => a + b, 0);
  let chi = 0;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const e = (rt[i] * ct[j]) / total;
    chi += (table[i][j] - e) ** 2 / e;
  }
  const df = (rows - 1) * (cols - 1);
  return done({ statistic: chi, statName: 'χ²', p: 1 - chi2Cdf(chi, df), df, details: { total } });
}

export interface Interval {
  lower: number;
  upper: number;
  estimate: number;
  margin: number;
  critical: number;
  df?: number;
}

export function zInterval(mean: number, sigma: number, n: number, level = 0.95): Interval {
  const z = normInv(1 - (1 - level) / 2);
  const m = (z * sigma) / Math.sqrt(n);
  return { lower: mean - m, upper: mean + m, estimate: mean, margin: m, critical: z };
}

export function tInterval(mean: number, sd: number, n: number, level = 0.95): Interval {
  const df = n - 1;
  const t = invertCdf((x) => tCdf(x, df), 1 - (1 - level) / 2, -Infinity, Infinity);
  const m = (t * sd) / Math.sqrt(n);
  return { lower: mean - m, upper: mean + m, estimate: mean, margin: m, critical: t, df };
}

export function propInterval(successes: number, n: number, level = 0.95): Interval {
  const p = successes / n;
  const z = normInv(1 - (1 - level) / 2);
  const m = z * Math.sqrt((p * (1 - p)) / n);
  return { lower: p - m, upper: p + m, estimate: p, margin: m, critical: z };
}
