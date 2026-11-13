/**
 * Equation solvers: polynomial roots (Aberth-Ehrlich), linear systems
 * (Gauss-Jordan with full classification), and numeric roots of f(x) = g(x).
 */
import { findRoots, clean } from './numerics.js';

export interface Cx {
  re: number;
  im: number;
}

const cadd = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im });
const csub = (a: Cx, b: Cx): Cx => ({ re: a.re - b.re, im: a.im - b.im });
const cmul = (a: Cx, b: Cx): Cx => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const cdiv = (a: Cx, b: Cx): Cx => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
const cabs = (a: Cx) => Math.hypot(a.re, a.im);

function horner(coeffs: number[], z: Cx): [Cx, Cx] {
  // returns p(z), p'(z); coeffs highest degree first
  let p: Cx = { re: coeffs[0], im: 0 };
  let d: Cx = { re: 0, im: 0 };
  for (let i = 1; i < coeffs.length; i++) {
    d = cadd(cmul(d, z), p);
    p = cadd(cmul(p, z), { re: coeffs[i], im: 0 });
  }
  return [p, d];
}

/**
 * All complex roots of a polynomial given coefficients from the highest
 * degree down, e.g. [1, 0, -4] for x^2 - 4.
 */
export function polyRoots(coeffsIn: number[]): Cx[] {
  const coeffs = coeffsIn.slice();
  while (coeffs.length && coeffs[0] === 0) coeffs.shift();
  if (coeffs.length < 2) return [];
  // factor out zero roots
  const zeros: Cx[] = [];
  while (coeffs.length > 1 && coeffs[coeffs.length - 1] === 0) {
    coeffs.pop();
    zeros.push({ re: 0, im: 0 });
  }
  const n = coeffs.length - 1;
  if (n === 0) return zeros;
  if (n === 1) return [...zeros, { re: -coeffs[1] / coeffs[0], im: 0 }];
  if (n === 2) {
    const [a, b, c] = coeffs;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      // numerically stable form
      const q = -0.5 * (b + Math.sign(b || 1) * s);
      const r1 = q / a;
      const r2 = q !== 0 ? c / q : -b / (2 * a);
      return [...zeros, ...[r1, r2].sort((x, y) => x - y).map((re) => ({ re: clean(re, 14), im: 0 }))];
    }
    const s = Math.sqrt(-disc);
    return [...zeros, { re: clean(-b / (2 * a), 14), im: clean(-s / (2 * a), 14) }, { re: clean(-b / (2 * a), 14), im: clean(s / (2 * a), 14) }];
  }
  const lead = coeffs[0];
  const monic = coeffs.map((c) => c / lead);
  // initial guesses on a circle bounded by Cauchy's bound
  const bound = 1 + Math.max(...monic.slice(1).map(Math.abs));
  const radius = Math.min(bound, Math.pow(Math.abs(monic[n]), 1 / n) || 1);
  let z: Cx[] = Array.from({ length: n }, (_, k) => {
    const ang = (2 * Math.PI * k) / n + 0.4;
    return { re: radius * Math.cos(ang), im: radius * Math.sin(ang) };
  });
  for (let iter = 0; iter < 500; iter++) {
    let maxStep = 0;
    const next = z.map((zi, i) => {
      const [p, d] = horner(monic, zi);
      if (cabs(p) === 0) return zi;
      const ratio = cdiv(p, d);
      let sum: Cx = { re: 0, im: 0 };
      for (let j = 0; j < n; j++) if (j !== i) sum = cadd(sum, cdiv({ re: 1, im: 0 }, csub(zi, z[j])));
      const w = cdiv(ratio, csub({ re: 1, im: 0 }, cmul(ratio, sum)));
      maxStep = Math.max(maxStep, cabs(w));
      return csub(zi, w);
    });
    z = next;
    if (maxStep < 1e-15) break;
  }
  // polish with Newton and clean
  const roots = z.map((r) => {
    let x = r;
    for (let k = 0; k < 5; k++) {
      const [p, d] = horner(monic, x);
      if (cabs(d) === 0) break;
      const step = cdiv(p, d);
      if (cabs(step) < 1e-17) break;
      x = csub(x, step);
    }
    const scale = Math.max(1, cabs(x));
    if (Math.abs(x.im) < 1e-10 * scale) x = { re: x.re, im: 0 };
    return { re: clean(x.re, 13), im: clean(x.im, 13) };
  });
  roots.sort((a, b) => (Math.abs(a.im) > 0 ? 1 : 0) - (Math.abs(b.im) > 0 ? 1 : 0) || a.re - b.re || a.im - b.im);
  return [...zeros, ...roots];
}

export type LinearSolution =
  | { kind: 'unique'; x: number[] }
  | { kind: 'infinite'; particular: number[]; free: number[]; basis: number[][]; rref: number[][] }
  | { kind: 'none'; rref: number[][] };

/** Reduced row echelon form with partial pivoting. Returns [rref, pivotColumns]. */
export function rref(m: number[][], tol = 1e-11): [number[][], number[]] {
  const A = m.map((r) => r.slice());
  const rows = A.length;
  const cols = rows ? A[0].length : 0;
  const scale = Math.max(1, ...A.flat().map(Math.abs));
  const eps = tol * scale;
  const pivots: number[] = [];
  let r = 0;
  for (let c = 0; c < cols && r < rows; c++) {
    let best = r;
    for (let i = r + 1; i < rows; i++) if (Math.abs(A[i][c]) > Math.abs(A[best][c])) best = i;
    if (Math.abs(A[best][c]) <= eps) continue;
    [A[r], A[best]] = [A[best], A[r]];
    const pv = A[r][c];
    for (let j = 0; j < cols; j++) A[r][j] /= pv;
    for (let i = 0; i < rows; i++) {
      if (i === r) continue;
      const f = A[i][c];
      if (f === 0) continue;
      for (let j = 0; j < cols; j++) A[i][j] -= f * A[r][j];
    }
    pivots.push(c);
    r++;
  }
  for (const row of A) for (let j = 0; j < cols; j++) row[j] = Math.abs(row[j]) < eps ? 0 : clean(row[j], 13);
  return [A, pivots];
}

/** Solve A x = b and classify the solution set. */
export function solveLinear(A: number[][], b: number[]): LinearSolution {
  const n = A[0]?.length ?? 0;
  const aug = A.map((row, i) => [...row, b[i]]);
  const [R, pivots] = rref(aug);
  if (pivots.includes(n)) return { kind: 'none', rref: R };
  if (pivots.length === n) {
    const x = new Array(n).fill(0);
    pivots.forEach((c, i) => (x[c] = R[i][n]));
    return { kind: 'unique', x: x.map((v) => clean(v, 13)) };
  }
  const free = [...Array(n).keys()].filter((c) => !pivots.includes(c));
  const particular = new Array(n).fill(0);
  pivots.forEach((c, i) => (particular[c] = R[i][n]));
  const basis = free.map((f) => {
    const v = new Array(n).fill(0);
    v[f] = 1;
    pivots.forEach((c, i) => (v[c] = -R[i][f]));
    return v;
  });
  return { kind: 'infinite', particular, free, basis, rref: R };
}

export function rank(m: number[][]): number {
  return rref(m)[1].length;
}

/** Roots of f(x) = 0 within [a, b]. */
export function solveEquation(f: (x: number) => number, a = -100, b = 100): number[] {
  return findRoots(f, a, b, 4000).map((r) => clean(r, 12));
}
