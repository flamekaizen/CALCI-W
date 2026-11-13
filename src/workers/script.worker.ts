/// <reference lib="webworker" />
/**
 * Sandboxed script runner. Runs user JavaScript (or Python via Pyodide) off the
 * main thread with no DOM access. The host terminates the worker to stop
 * runaway scripts.
 *
 * In:  { type: 'run', lang: 'js' | 'python', code: string, library: string }
 * Out: { type: 'print' | 'table' | 'plot' | 'error' | 'status' | 'done', ... }
 */
import { Calculator, createMath, solver, stats, finance, units, calculus, numerics } from '../core/index';

declare const self: DedicatedWorkerGlobalScope;

const post = (msg: Record<string, unknown>) => self.postMessage(msg);

function fmtArg(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean' || v == null) return String(v);
  const o = v as any;
  if (o.isMatrix || o.isComplex || o.isUnit || o.isBigNumber || o.isFraction) return o.toString();
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x), 2);
  } catch {
    return String(v);
  }
}

function toRows(rows: unknown): Record<string, unknown>[] {
  if (Array.isArray(rows)) {
    return rows.slice(0, 2000).map((r) => {
      if (r && typeof r === 'object' && !Array.isArray(r)) return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, fmtArg(v)]));
      if (Array.isArray(r)) return Object.fromEntries(r.map((v, i) => [String(i), fmtArg(v)]));
      return { value: fmtArg(r) };
    });
  }
  if (rows && typeof rows === 'object') return Object.entries(rows).map(([k, v]) => ({ key: k, value: fmtArg(v) }));
  return [{ value: fmtArg(rows) }];
}

function sample(f: (x: number) => number, a: number, b: number, n = 600): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const x = a + ((b - a) * i) / n;
    let y = NaN;
    try {
      y = Number(f(x));
    } catch {
      y = NaN;
    }
    pts.push([x, Number.isFinite(y) ? y : NaN]);
  }
  return pts;
}

function makePlot(math: ReturnType<typeof createMath>) {
  return (f: unknown, a = -10, b = 10, label?: string) => {
    let fn: (x: number) => number;
    let name = label;
    if (typeof f === 'function') fn = f as (x: number) => number;
    else if (typeof f === 'string') {
      const src = f.replace(/^\s*\w+\s*->\s*/, '');
      const code = math.compile(src);
      fn = (x) => Number(code.evaluate({ x }));
      name ??= src;
    } else if (Array.isArray(f)) {
      post({ type: 'plot', series: [{ pts: (f as [number, number][]).slice(0, 5000), points: true, label: name ?? 'data' }] });
      return;
    } else throw new Error('plot(f, a, b): f must be a function, an expression string or an array of [x, y] points');
    post({ type: 'plot', series: [{ pts: sample(fn, Number(a), Number(b)), label: name ?? 'f' }] });
  };
}

async function runJs(code: string, library: string) {
  const calc = new Calculator();
  const libErrors = calc.loadLibrary(library);
  if (libErrors.length) post({ type: 'print', level: 'info', text: `Library: ${libErrors.length} line(s) skipped due to errors` });
  const math = calc.math;
  // expose library functions on math for direct calls: math.scope.get('f')(2)
  const calci = {
    evaluate: (expr: string) => {
      const r = calc.evaluate(expr);
      if (!r.ok) throw new Error(r.error);
      return r.value;
    },
    format: (v: unknown) => calc.format(v).text,
    scope: calc.scope,
    solver,
    stats,
    finance,
    units,
    calculus,
    numerics,
  };
  const print = (...args: unknown[]) => post({ type: 'print', text: args.map(fmtArg).join(' ') });
  const table = (rows: unknown) => post({ type: 'table', rows: toRows(rows) });
  const plot = makePlot(math);
  const consoleShim = { log: print, info: print, warn: print, error: (...a: unknown[]) => post({ type: 'print', level: 'err', text: a.map(fmtArg).join(' ') }), table };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<unknown>;
  const fn = new AsyncFunction('math', 'calci', 'print', 'table', 'plot', 'console', `"use strict";\n${code}`);
  const result = await fn(math, calci, print, table, plot, consoleShim);
  if (result !== undefined) print(result);
}

let pyodide: any = null;
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';

async function runPython(code: string) {
  if (!pyodide) {
    post({ type: 'status', text: 'Loading Python runtime (first run only)…' });
    const mod = await import(/* @vite-ignore */ `${PYODIDE}pyodide.mjs`);
    pyodide = await mod.loadPyodide({ indexURL: PYODIDE });
    post({ type: 'status', text: 'Python ready' });
  }
  pyodide.setStdout({ batched: (s: string) => post({ type: 'print', text: s }) });
  pyodide.setStderr({ batched: (s: string) => post({ type: 'print', level: 'err', text: s }) });
  const math = createMath();
  pyodide.globals.set('plot', (f: unknown, a = -10, b = 10) => {
    const fn = typeof f === 'string' ? f : (f as any)?.toJs ? (f as any).toJs() : f;
    if (typeof fn === 'function' || (fn && typeof (fn as any).call === 'function')) {
      post({ type: 'plot', series: [{ pts: sample((x) => Number((f as any)(x)), a, b), label: 'f' }] });
    } else makePlot(math)(fn, a, b);
  });
  pyodide.globals.set('table', (rows: any) => post({ type: 'table', rows: toRows(rows?.toJs ? rows.toJs({ dict_converter: Object.fromEntries }) : rows) }));
  await pyodide.loadPackagesFromImports(code);
  const r = await pyodide.runPythonAsync(code);
  if (r !== undefined && r !== null) post({ type: 'print', text: String(r) });
}

self.onmessage = async (e: MessageEvent) => {
  const d = e.data;
  if (d?.type !== 'run') return;
  const t0 = performance.now();
  try {
    if (d.lang === 'python') await runPython(String(d.code));
    else await runJs(String(d.code), String(d.library ?? ''));
    post({ type: 'done', ms: performance.now() - t0 });
  } catch (err) {
    const e2 = err as Error;
    post({ type: 'error', message: e2?.message ?? String(err) });
    post({ type: 'done', ms: performance.now() - t0, failed: true });
  }
};
