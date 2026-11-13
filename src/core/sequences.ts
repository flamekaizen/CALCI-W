/**
 * Sequences: explicit u(n) = expr(n), recursive u(n) = expr(n, u(n-1), u(n-2), …)
 * with initial terms, and coupled pairs u / v (each may refer to earlier
 * terms of the other, and to the other's current term when that is not
 * circular). Plus helpers: arithmetic / geometric detection, partial sums and
 * a convergence hint.
 *
 * Pure TypeScript, no DOM. Expressions are compiled to native functions via
 * compileNode, so evaluating 10,000 terms takes a few milliseconds.
 */
import { parse as mparse, type MathNode } from 'mathjs';
import { normalizeInput } from './normalize.js';
import { compileNode, CompileError, type AngleUnit, type NumFn } from './compile.js';
import { compileGraph } from './graph/parse.js';

/** Hard cap on the number of terms computed in one evaluation. */
export const MAX_SEQUENCE_TERMS = 10_000;

export type SeqName = 'u' | 'v';

export interface SequenceSpec {
  /** Right-hand side of u(n) = …, e.g. "2n+1" or "u(n-1) + u(n-2)". A leading "u(n) =" is accepted. */
  expr: string;
  /** Initial terms u(nMin), u(nMin+1), … (used only when the expression refers to earlier terms). */
  initial?: number[];
}

export interface SequenceDef {
  u: string | SequenceSpec;
  v?: string | SequenceSpec | null;
  /** Index of the first term (default 1). Initial terms start here. */
  nMin?: number;
  angle?: AngleUnit;
  /** User library lines, e.g. ["f(x) = x^2", "a = 3"]. */
  library?: string[];
  /** Extra named constants. */
  constants?: Record<string, number>;
  /** Override the term cap (never above MAX_SEQUENCE_TERMS). */
  maxTerms?: number;
  /** Wall-clock budget in ms (default 1500). */
  timeLimitMs?: number;
}

export interface SequenceInfo {
  kind: 'explicit' | 'recursive';
  /** Number of initial terms the definition needs. */
  needs: number;
  /** Which sequences the expression refers to. */
  refs: SeqName[];
}

export interface SequenceResult {
  n: number[];
  u: number[];
  v: number[] | null;
  info: { u: SequenceInfo | null; v: SequenceInfo | null };
  /** True when the requested range was cut short (term cap, time limit or divergence). */
  truncated: boolean;
  /** First non-finite term encountered, if any. */
  nonFinite: { seq: SeqName; n: number } | null;
  warnings: string[];
  error: string | null;
}

interface Ref {
  target: SeqName;
  /** n - index, when the index has the form n - k; null for anything else (u(1), u(floor(n/2))…). */
  lag: number | null;
}

interface Prepared {
  name: SeqName;
  fn: NumFn;
  initial: number[];
  info: SequenceInfo;
  refs: Ref[];
}

const toSpec = (s: string | SequenceSpec): SequenceSpec => (typeof s === 'string' ? { expr: s } : s);

/** Accept "u(n) = …", "u[n-1]", "u_{n-1}" and friends. */
export function prepareSequenceText(text: string, name: SeqName): string {
  let s = text.trim();
  const head = new RegExp(`^${name}\\s*(?:\\(\\s*n\\s*\\)|_n|_\\{n\\}|\\[\\s*n\\s*\\])\\s*=(?!=)`);
  s = s.replace(head, '').trim();
  s = s.replace(/\b([uv])\s*\[([^[\]]*)\]/g, '$1($2)');
  s = s.replace(/\b([uv])_\{([^{}]*)\}/g, '$1($2)');
  s = s.replace(/\b([uv])_\(([^()]*)\)/g, '$1($2)');
  return s;
}

function round12(v: number): number {
  return Number.isFinite(v) ? Number(v.toPrecision(12)) : v;
}

function cleanError(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  if (e instanceof CompileError && e.symbol === 'x') return 'Use n as the variable (x is not defined here)';
  return msg.replace(/\s*\(char \d+\)$/, '');
}

function emptyResult(error: string | null, info: SequenceResult['info'] = { u: null, v: null }): SequenceResult {
  return { n: [], u: [], v: null, info, truncated: false, nonFinite: null, warnings: [], error };
}

/**
 * Evaluate u(n) (and optionally v(n)) for n = nStart … nEnd.
 *
 * Recursive definitions are always computed from nMin, so the result is
 * exact for any visible window. At most MAX_SEQUENCE_TERMS terms are
 * computed; a recursive sequence stops at its first non-finite term.
 */
export function evaluateSequence(def: string | SequenceDef, nStart: number, nEnd: number): SequenceResult {
  const d: SequenceDef = typeof def === 'string' ? { u: def } : def;
  const angle = d.angle ?? 'rad';
  const nMin = Math.round(d.nMin ?? 1);
  const maxTerms = Math.max(1, Math.min(MAX_SEQUENCE_TERMS, Math.floor(d.maxTerms ?? MAX_SEQUENCE_TERMS)));
  const timeLimit = d.timeLimitMs ?? 1500;
  if (!Number.isFinite(nMin) || !Number.isFinite(nStart) || !Number.isFinite(nEnd)) return emptyResult('The n range must be finite');
  let start = Math.round(nStart);
  const end = Math.round(nEnd);
  if (start > end) return emptyResult('Start n must not be greater than end n');

  // library functions & constants
  let libFunctions: Record<string, NumFn> = {};
  let libConstants: Record<string, number> = {};
  if (d.library?.length) {
    try {
      const g = compileGraph([], { angle, library: d.library });
      libFunctions = g.functions;
      libConstants = g.constants;
    } catch {
      /* ignore broken library */
    }
  }
  const constants: Record<string, number> = { ...libConstants, ...(d.constants ?? {}) };

  // evaluation state shared with the lookup functions
  let from = start;
  let cur = Number.NEGATIVE_INFINITY;
  let size = 0;
  let memo: Record<SeqName, Float64Array> = { u: new Float64Array(0), v: new Float64Array(0) };
  let state: Record<SeqName, Uint8Array> = { u: new Uint8Array(0), v: new Uint8Array(0) };
  let cycle = false;
  const prepared: Partial<Record<SeqName, Prepared>> = {};

  const compute = (s: SeqName, idx: number): number => {
    const p = prepared[s];
    const i = idx - from;
    if (!p) return NaN;
    state[s][i] = 1;
    let val: number;
    const k = idx - nMin;
    if (p.info.kind === 'recursive' && k >= 0 && k < p.initial.length) val = p.initial[k];
    else {
      try {
        val = p.fn(idx);
      } catch {
        val = NaN; // e.g. stack overflow in a library function
      }
    }
    memo[s][i] = val;
    state[s][i] = 2;
    return val;
  };

  const lookup = (s: SeqName) => (k: number): number => {
    if (!Number.isFinite(k)) return NaN;
    const idx = Math.round(k);
    if (Math.abs(k - idx) > 1e-9) return NaN;
    if (idx > cur || idx < from || idx - from >= size) return NaN;
    const i = idx - from;
    const st = state[s][i];
    if (st === 2) return memo[s][i];
    if (st === 1) {
      cycle = true;
      return NaN;
    }
    return compute(s, idx);
  };

  const functions: Record<string, NumFn> = { ...libFunctions, u: lookup('u'), v: lookup('v') };

  const prepare = (name: SeqName, raw: string | SequenceSpec): Prepared | string => {
    const spec = toSpec(raw);
    const text = prepareSequenceText(spec.expr ?? '', name);
    if (!text) return `Enter an expression for ${name}(n)`;
    let node: MathNode;
    try {
      node = mparse(normalizeInput(text));
    } catch (e) {
      return `${name}(n): ${cleanError(e)}`;
    }
    const refs: Ref[] = [];
    let refError: string | null = null;
    node.traverse((nd: any) => {
      if (refError || nd.type !== 'FunctionNode') return;
      const fname: string | undefined = nd.fn?.name;
      if (fname !== 'u' && fname !== 'v') return;
      if (nd.args.length !== 1) {
        refError = `${fname}(…) takes exactly one argument`;
        return;
      }
      let lag: number | null = null;
      try {
        const arg = compileNode(nd.args[0], { vars: ['n'], constants, functions, angle });
        const a1 = arg(1000);
        const a2 = arg(1001);
        if (Number.isFinite(a1) && Math.abs(a2 - a1 - 1) < 1e-9 && Math.abs(1000 - a1 - Math.round(1000 - a1)) < 1e-9) lag = Math.round(1000 - a1);
      } catch (e) {
        refError = `${name}(n): ${cleanError(e)}`;
        return;
      }
      if (lag !== null && lag < 0) {
        refError = `${name}(n) refers to a later term ${fname}(n+${-lag})`;
        return;
      }
      if (lag === 0 && fname === name) {
        refError = `${name}(n) can't refer to itself — use ${name}(n-1)`;
        return;
      }
      refs.push({ target: fname, lag });
    });
    if (refError) return refError;
    let fn: NumFn;
    try {
      fn = compileNode(node, { vars: ['n'], constants, functions, angle });
    } catch (e) {
      return `${name}(n): ${cleanError(e)}`;
    }
    const lags = refs.map((r) => r.lag).filter((l): l is number => l !== null && l > 0);
    let needs = lags.length ? Math.max(...lags) : 0;
    if (refs.some((r) => r.lag === null && r.target === name)) needs = Math.max(needs, 1);
    const initial = (spec.initial ?? []).map(Number);
    const kind: SequenceInfo['kind'] = refs.length ? 'recursive' : 'explicit';
    return { name, fn, initial, refs, info: { kind, needs, refs: [...new Set(refs.map((r) => r.target))] } };
  };

  const pu = prepare('u', d.u);
  if (typeof pu === 'string') return emptyResult(pu);
  prepared.u = pu;
  const hasV = d.v != null && toSpec(d.v).expr?.trim() !== '';
  if (hasV) {
    const pv = prepare('v', d.v!);
    if (typeof pv === 'string') return emptyResult(pv, { u: pu.info, v: null });
    prepared.v = pv;
  } else if (pu.info.refs.includes('v')) {
    return emptyResult('u(n) refers to v, but v(n) is not defined', { u: pu.info, v: null });
  }
  const pv = prepared.v ?? null;
  const info = { u: pu.info, v: pv?.info ?? null };

  // same-index mutual dependency
  if (pv && pu.refs.some((r) => r.target === 'v' && r.lag === 0) && pv.refs.some((r) => r.target === 'u' && r.lag === 0)) {
    return emptyResult('u(n) and v(n) depend on each other at the same n', info);
  }

  const warnings: string[] = [];
  for (const p of [pu, pv]) {
    if (!p || p.info.kind !== 'recursive') continue;
    if (p.initial.length < p.info.needs) {
      const list = Array.from({ length: p.info.needs }, (_, i) => `${p.name}(${nMin + i})`).join(', ');
      return emptyResult(`${p.name}(n) needs ${p.info.needs} initial term${p.info.needs > 1 ? 's' : ''}: ${list}`, info);
    }
    if (p.initial.some((v) => !Number.isFinite(v))) return emptyResult(`Initial terms of ${p.name} must be finite numbers`, info);
  }

  const recursive = pu.info.kind === 'recursive' || pv?.info.kind === 'recursive';
  if (recursive) {
    if (start < nMin) {
      warnings.push(`Recursive sequences start at n = ${nMin}`);
      start = nMin;
      if (start > end) return { ...emptyResult(null, info), warnings };
    }
    from = nMin;
  } else from = start;

  let last = end;
  let truncated = false;
  if (last - from + 1 > maxTerms) {
    last = from + maxTerms - 1;
    truncated = true;
    warnings.push(`Limited to ${maxTerms.toLocaleString('en-US')} terms (n ≤ ${last})`);
  }
  if (last < start) return { ...emptyResult(null, info), truncated, warnings };

  size = last - from + 1;
  memo = { u: new Float64Array(size).fill(NaN), v: new Float64Array(pv ? size : 0).fill(NaN) };
  state = { u: new Uint8Array(size), v: new Uint8Array(pv ? size : 0) };

  const t0 = Date.now();
  let nonFinite: SequenceResult['nonFinite'] = null;
  let lastDone = from - 1;
  for (let n = from; n <= last; n++) {
    cur = n;
    const i = n - from;
    if (state.u[i] !== 2) compute('u', n);
    if (pv && state.v[i] !== 2) compute('v', n);
    lastDone = n;
    let stop = false;
    for (const p of [pu, pv]) {
      if (!p) continue;
      const val = memo[p.name][i];
      if (!Number.isFinite(val) && !nonFinite) nonFinite = { seq: p.name, n };
      if (!Number.isFinite(val) && p.info.kind === 'recursive' && n >= nMin + p.initial.length) stop = true;
    }
    if (stop && n < last) {
      truncated = true;
      const nf = nonFinite!;
      warnings.push(`${nf.seq}(${nf.n}) is not a finite number — stopped`);
      break;
    }
    if ((i & 511) === 511 && Date.now() - t0 > timeLimit && n < last) {
      truncated = true;
      warnings.push(`Stopped at n = ${n} (time limit)`);
      break;
    }
  }
  if (cycle) warnings.push('Circular reference between u and v at the same n');

  const outN: number[] = [];
  const outU: number[] = [];
  const outV: number[] | null = pv ? [] : null;
  for (let n = Math.max(start, from); n <= lastDone; n++) {
    const i = n - from;
    outN.push(n);
    outU.push(memo.u[i]);
    if (outV) outV.push(memo.v[i]);
  }
  return { n: outN, u: outU, v: outV, info, truncated, nonFinite, warnings, error: null };
}

/* ------------------------------------------------------------------ analysis */

export type Progression =
  | { type: 'arithmetic'; d: number; first: number }
  | { type: 'geometric'; r: number; first: number };

/**
 * Detect an arithmetic (constant difference d) or geometric (constant ratio r)
 * progression. Needs at least 3 finite terms. A constant sequence is reported
 * as arithmetic with d = 0.
 */
export function detectProgression(terms: number[]): Progression | null {
  if (terms.length < 3 || !terms.every(Number.isFinite)) return null;
  const scale = Math.max(1, ...terms.map(Math.abs));
  const d0 = terms[1] - terms[0];
  let arith = true;
  for (let i = 2; i < terms.length && arith; i++) {
    if (Math.abs(terms[i] - terms[i - 1] - d0) > 1e-9 * scale) arith = false;
  }
  if (arith) return { type: 'arithmetic', d: round12(d0), first: terms[0] };
  if (terms.some((t) => t === 0)) return null;
  const r0 = terms[1] / terms[0];
  for (let i = 2; i < terms.length; i++) {
    if (Math.abs(terms[i] / terms[i - 1] - r0) > 1e-9 * Math.max(1, Math.abs(r0))) return null;
  }
  return { type: 'geometric', r: round12(r0), first: terms[0] };
}

const numText = (v: number) => {
  const r = round12(v);
  return r < 0 ? `−${-r}` : String(r);
};

/** Closed form of a detected progression, e.g. "u(n) = 3 + 2(n − 1)". */
export function progressionFormula(p: Progression, n0 = 1, name = 'u'): string {
  const shift = n0 === 0 ? 'n' : n0 > 0 ? `n − ${n0}` : `n + ${-n0}`;
  if (p.type === 'arithmetic') {
    if (p.d === 0) return `${name}(n) = ${numText(p.first)}`;
    const dTxt = p.d === 1 ? '' : p.d === -1 ? '−' : numText(p.d);
    const term = n0 === 0 ? `${dTxt}n` : `${dTxt}(${shift})`;
    if (p.first === 0) return `${name}(n) = ${term}`;
    return `${name}(n) = ${numText(p.first)} ${term.startsWith('−') ? '− ' + term.slice(1) : '+ ' + term}`;
  }
  const rTxt = p.r < 0 ? `(${numText(p.r)})` : numText(p.r);
  const pow = n0 === 0 ? `${rTxt}^n` : `${rTxt}^(${shift})`;
  return p.first === 1 ? `${name}(n) = ${pow}` : `${name}(n) = ${numText(p.first)}·${pow}`;
}

/** Running sums S(k) = t0 + … + tk (compensated summation). NaN propagates. */
export function partialSums(terms: number[]): number[] {
  const out: number[] = new Array(terms.length);
  let s = 0;
  let c = 0;
  for (let i = 0; i < terms.length; i++) {
    const x = terms[i];
    const t = s + x;
    if (Number.isFinite(t)) {
      c += Math.abs(s) >= Math.abs(x) ? s - t + x : x - t + s;
    } else c = 0;
    s = t;
    out[i] = Number.isFinite(s) ? s + c : s;
  }
  return out;
}

export interface ConvergenceHint {
  kind: 'converges' | 'diverges' | 'oscillates' | 'periodic' | 'unknown';
  /** Estimated limit (converges). */
  limit?: number;
  /** +1 / -1 for divergence to ±∞; 0 for unbounded oscillation. */
  direction?: 1 | -1 | 0;
  period?: number;
  message: string;
}

/** Heuristic look at the tail of a sequence: does it approach a limit? */
export function convergenceHint(terms: number[]): ConvergenceHint {
  const fin = terms.filter(Number.isFinite);
  if (fin.length !== terms.length && terms.length) {
    const lastBad = terms[terms.length - 1];
    if (lastBad === Infinity || lastBad === -Infinity) {
      const dir = lastBad > 0 ? 1 : -1;
      return { kind: 'diverges', direction: dir, message: `Diverges to ${dir > 0 ? '+∞' : '−∞'}` };
    }
  }
  if (fin.length < 6) return { kind: 'unknown', message: 'Not enough terms to judge' };
  const t = fin.slice(-24);
  const L = t.length;
  const last = t[L - 1];
  const scale = Math.max(1, Math.abs(last));
  const d: number[] = [];
  for (let i = 1; i < L; i++) d.push(t[i] - t[i - 1]);
  const ad = d.map(Math.abs);
  const tiny = 1e-12 * scale;

  if (ad.slice(-4).every((x) => x <= tiny)) {
    return { kind: 'converges', limit: round12(last), message: `Converges to ${round12(last)}` };
  }

  // periodic (period 2..6)
  for (let p = 2; p <= 6 && p * 2 < L; p++) {
    let ok = true;
    for (let i = L - 1; i >= p && i >= L - 3 * p && ok; i--) {
      if (Math.abs(t[i] - t[i - p]) > 1e-9 * scale) ok = false;
    }
    const cycle = t.slice(-p);
    const spread = Math.max(...cycle) - Math.min(...cycle);
    // a converging tail also repeats within tolerance; require a genuine cycle
    if (ok && spread > 1e-6 * scale) return { kind: 'periodic', period: p, message: `Periodic with period ${p}` };
  }

  if (Math.abs(last) > 1e15) {
    const signs = t.slice(-6).map(Math.sign);
    if (signs.every((s) => s === signs[0])) {
      const dir = signs[0] > 0 ? 1 : -1;
      return { kind: 'diverges', direction: dir, message: `Diverges to ${dir > 0 ? '+∞' : '−∞'}` };
    }
    return { kind: 'diverges', direction: 0, message: 'Unbounded oscillation' };
  }

  // ratio of successive differences (geometric-like decay)
  const recent = ad.slice(-6);
  const ratios: number[] = [];
  for (let i = 1; i < recent.length; i++) ratios.push(recent[i - 1] === 0 ? 0 : recent[i] / recent[i - 1]);
  const aitken = () => {
    const [x0, x1, x2] = t.slice(-3);
    const den = x2 - 2 * x1 + x0;
    const est = den !== 0 && Number.isFinite(den) ? x2 - ((x2 - x1) * (x2 - x1)) / den : x2;
    return Number.isFinite(est) ? est : x2;
  };
  if (ratios.length && ratios.every((r) => r < 0.97)) {
    const lim = round12(aitken());
    return { kind: 'converges', limit: lim, message: `Appears to converge to ≈ ${lim}` };
  }
  const lastD = ad[ad.length - 1];
  const decreasing = ad.slice(-6).every((x, i, a) => i === 0 || x <= a[i - 1] * (1 + 1e-12));
  if (decreasing && lastD < 1e-7 * scale) {
    return { kind: 'converges', limit: round12(last), message: `Slowly approaches ≈ ${round12(last)}` };
  }
  const signs = d.slice(-8).map(Math.sign);
  const monotone = signs.every((s) => s === signs[0] && s !== 0);
  const growing = ratios.length > 0 && ratios.every((r) => r >= 0.999);
  // only call it divergence when the tail sets a new record for the whole sequence
  const record = Math.abs(last) >= Math.max(...fin.map(Math.abs)) * (1 - 1e-12);
  if (monotone && growing && record) {
    const dir = signs[0] > 0 ? 1 : -1;
    return { kind: 'diverges', direction: dir, message: `Diverges to ${dir > 0 ? '+∞' : '−∞'}` };
  }
  const alternating = signs.every((s, i) => i === 0 || s === -signs[i - 1]);
  if (alternating) {
    if (growing && ratios.some((r) => r > 1.001)) return { kind: 'diverges', direction: 0, message: 'Oscillates with growing amplitude' };
    return { kind: 'oscillates', message: 'Oscillates (no single limit)' };
  }
  if (monotone) return { kind: 'unknown', message: `${signs[0] > 0 ? 'Increasing' : 'Decreasing'}, no clear limit yet` };
  return { kind: 'unknown', message: 'No clear limit' };
}
