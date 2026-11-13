import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Copy, Download, Sigma } from 'lucide-react';
import { compileGraph, type GraphLine } from '../../core/graph/parse';
import { CURVE_COLORS_LIGHT, CURVE_COLORS_DARK } from '../../core/graph/palette';
import {
  evaluateSequence,
  detectProgression,
  progressionFormula,
  partialSums,
  convergenceHint,
  MAX_SEQUENCE_TERMS,
  type SequenceResult,
} from '../../core/sequences';
import { useStore } from '../store';
import { libraryLines } from '../engine';
import { Tabs, NumberInput, fmt, toast, copyText, parseNumber, useResolvedTheme } from '../ui';
import { Plot, type Series } from '../components/Plot';
import '../../styles/modes/tools.css';
import '../../styles/modes/table.css';

/* ------------------------------------------------------------------ state */

type Tab = 'fn' | 'seq';
const KEY = 'calci-table-v1';
const MAX_ROWS = 2000;
const NAMES = ['f', 'g', 'h'] as const;

interface FnState {
  exprs: string[];
  start: number;
  end: number;
  step: number;
  at: number;
}
interface SeqSlot {
  expr: string;
  init: string;
}
interface SeqState {
  u: SeqSlot;
  v: SeqSlot;
  useV: boolean;
  nMin: number;
  from: number;
  to: number;
  connect: boolean;
}
interface Saved {
  tab: Tab;
  fn: FnState;
  seq: SeqState;
}

const DEFAULTS: Saved = {
  tab: 'fn',
  fn: { exprs: ['x^3 - 3x', 'x^2 - 2', ''], start: -3, end: 3, step: 0.5, at: 1.5 },
  seq: { u: { expr: 'u(n-1) + u(n-2)', init: '1, 1' }, v: { expr: '', init: '' }, useV: false, nMin: 1, from: 1, to: 20, connect: false },
};

const isNum = (v: unknown): v is number => typeof v === 'number' && !Number.isNaN(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return DEFAULTS;
    const f = raw.fn ?? {};
    const s = raw.seq ?? {};
    const slot = (v: any, d: SeqSlot): SeqSlot => ({ expr: isStr(v?.expr) ? v.expr : d.expr, init: isStr(v?.init) ? v.init : d.init });
    return {
      tab: raw.tab === 'seq' ? 'seq' : 'fn',
      fn: {
        exprs: Array.isArray(f.exprs) ? [0, 1, 2].map((i) => (isStr(f.exprs[i]) ? f.exprs[i] : '')) : DEFAULTS.fn.exprs,
        start: isNum(f.start) ? f.start : DEFAULTS.fn.start,
        end: isNum(f.end) ? f.end : DEFAULTS.fn.end,
        step: isNum(f.step) ? f.step : DEFAULTS.fn.step,
        at: isNum(f.at) ? f.at : DEFAULTS.fn.at,
      },
      seq: {
        u: slot(s.u, DEFAULTS.seq.u),
        v: slot(s.v, DEFAULTS.seq.v),
        useV: s.useV === true,
        nMin: isNum(s.nMin) ? s.nMin : DEFAULTS.seq.nMin,
        from: isNum(s.from) ? s.from : DEFAULTS.seq.from,
        to: isNum(s.to) ? s.to : DEFAULTS.seq.to,
        connect: s.connect === true,
      },
    };
  } catch {
    return DEFAULTS;
  }
}

/* ------------------------------------------------------------------ helpers */

function csvCell(v: string | number): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : Number.isNaN(v) ? '' : v > 0 ? 'Infinity' : '-Infinity';
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
function toDelimited(header: string[], rows: (string | number)[][], sep: ',' | '\t'): string {
  const cell = (v: string | number) => (sep === ',' ? csvCell(v) : typeof v === 'number' ? csvCell(v) : v.replace(/[\t\r\n]/g, ' '));
  return [header, ...rows].map((r) => r.map(cell).join(sep)).join('\r\n');
}
function downloadText(filename: string, text: string) {
  try {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`Saved ${filename}`);
  } catch {
    toast('Download is not available here');
  }
}

/** Split "1, 2, log(8, 2)" at top-level commas / semicolons. */
function splitList(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    if ((c === ',' || c === ';') && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((p) => p.trim()).filter(Boolean);
}

const safe = (fn: (...a: number[]) => number) => (x: number) => {
  try {
    const y = fn(x);
    return typeof y === 'number' ? y : NaN;
  } catch {
    return NaN;
  }
};

function bisectRoot(f: (x: number) => number, a: number, b: number, fa: number): number {
  let lo = a;
  let hi = b;
  let flo = fa;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    if (m === lo || m === hi) break;
    const fm = f(m);
    if (!Number.isFinite(fm)) return NaN;
    if (fm === 0) return m;
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = m;
      flo = fm;
    } else hi = m;
  }
  return (lo + hi) / 2;
}

function goldenExtremum(f: (x: number) => number, a: number, b: number, max: boolean): number {
  const g = (Math.sqrt(5) - 1) / 2;
  const h = (x: number) => (max ? -f(x) : f(x));
  let lo = a;
  let hi = b;
  let c = hi - g * (hi - lo);
  let d = lo + g * (hi - lo);
  let fc = h(c);
  let fd = h(d);
  for (let i = 0; i < 90 && hi - lo > 1e-13 * Math.max(1, Math.abs(lo)); i++) {
    if (fc < fd) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - g * (hi - lo);
      fc = h(c);
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + g * (hi - lo);
      fd = h(d);
    }
  }
  return (lo + hi) / 2;
}

/** Extremum in [lo, hi]: bisection on the sign of f' (accurate), golden-section search as fallback. */
function refineExtremum(f: (x: number) => number, lo: number, hi: number, max: boolean): number {
  const d = (x: number) => {
    const h = 1e-6 * Math.max(1, Math.abs(x));
    return (f(x + h) - f(x - h)) / (2 * h);
  };
  let a = lo;
  let b = hi;
  let da = d(a);
  const db = d(b);
  if (Number.isFinite(da) && Number.isFinite(db) && da !== 0 && db !== 0 && Math.sign(da) !== Math.sign(db)) {
    for (let i = 0; i < 100; i++) {
      const m = (a + b) / 2;
      if (m === a || m === b) break;
      const dm = d(m);
      if (!Number.isFinite(dm)) return goldenExtremum(f, lo, hi, max);
      if (dm === 0) return m;
      if (Math.sign(dm) === Math.sign(da)) {
        a = m;
        da = dm;
      } else b = m;
    }
    return (a + b) / 2;
  }
  return goldenExtremum(f, lo, hi, max);
}

const snap = (v: number) => {
  if (!Number.isFinite(v)) return v;
  const r = Math.round(v);
  return Math.abs(v - r) < 1e-9 * Math.max(1, Math.abs(v)) ? r : Number(v.toPrecision(12));
};

function stripHead(text: string, name: string): string {
  return text.replace(new RegExp(`^\\s*(?:y|${name}\\s*\\(\\s*x\\s*\\))\\s*=(?!=)\\s*`), '');
}

function useCurveColors(): string[] {
  const dark = useResolvedTheme() === 'dark';
  return dark ? CURVE_COLORS_DARK : CURVE_COLORS_LIGHT;
}

function flashRow(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('tbl-flash');
  void el.offsetWidth;
  el.classList.add('tbl-flash');
}

/* ------------------------------------------------------------------ root */

export default function Table() {
  const [saved, setSaved] = useState<Saved>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(saved));
    } catch {
      /* storage unavailable */
    }
  }, [saved]);
  const setFn = (p: Partial<FnState>) => setSaved((s) => ({ ...s, fn: { ...s.fn, ...p } }));
  const setSeq = (p: Partial<SeqState>) => setSaved((s) => ({ ...s, seq: { ...s.seq, ...p } }));
  return (
    <div className="page wide">
      <Tabs
        value={saved.tab}
        onChange={(tab) => setSaved((s) => ({ ...s, tab }))}
        tabs={[
          { id: 'fn', label: 'Function table' },
          { id: 'seq', label: 'Sequences' },
        ]}
      />
      {saved.tab === 'fn' ? <FunctionTable st={saved.fn} set={setFn} /> : <SequenceTab st={saved.seq} set={setSeq} />}
    </div>
  );
}

/* ------------------------------------------------------------------ function table */

type Mark = 'root' | 'sign' | 'pole' | 'max' | 'min';
interface Feature {
  fn: number;
  kind: 'root' | 'max' | 'min';
  x: number;
  y: number;
  row: number;
  exact?: boolean;
}

const MARK_INFO: Record<Mark, { cls: string; glyph: string; text: string }> = {
  root: { cls: 'tbl-root', glyph: '●', text: 'root' },
  sign: { cls: 'tbl-root', glyph: '±', text: 'sign change: root between this row and the previous one' },
  pole: { cls: 'tbl-pole', glyph: '⨯', text: 'sign change across a discontinuity' },
  max: { cls: 'tbl-max', glyph: '▲', text: 'local maximum' },
  min: { cls: 'tbl-min', glyph: '▼', text: 'local minimum' },
};

function FunctionTable({ st, set }: { st: FnState; set: (p: Partial<FnState>) => void }) {
  const angle = useStore((s) => s.calc.angle);
  const library = useStore((s) => s.library);
  const colors = useCurveColors();

  const compiled = useMemo(() => {
    const lines: GraphLine[] = [];
    const active = st.exprs.map((t) => t.trim() !== '');
    st.exprs.forEach((text, i) => {
      if (!active[i]) return;
      const name = NAMES[i];
      const body = stripHead(text.trim(), name);
      const selfRef = new RegExp(`\\b${name}\\s*\\(`).test(body);
      if (!selfRef) lines.push({ id: `d${i}`, text: `${name}(x) = ${body}` });
      lines.push({ id: `p${i}`, text: selfRef ? body : `${name}(x)` });
    });
    let items: ReturnType<typeof compileGraph>['items'] = [];
    let globalError: string | null = null;
    try {
      items = compileGraph(lines, { angle, library: libraryLines() }).items;
    } catch (e) {
      globalError = (e as Error).message;
    }
    const byId = new Map(items.map((it) => [it.id, it]));
    return st.exprs.map((_, i) => {
      if (!active[i]) return { fn: null, error: null as string | null };
      if (globalError) return { fn: null, error: globalError };
      const def = byId.get(`d${i}`);
      if (def && def.kind !== 'function') return { fn: null, error: (def.error ?? 'Enter an expression in x').replace(/\s*\(char \d+\)$/, '') };
      const p = byId.get(`p${i}`);
      if (p?.kind === 'explicit' && p.fn) return { fn: safe(p.fn), error: null };
      if (p?.kind === 'value' && p.value !== undefined) {
        const v = p.value;
        return { fn: () => v, error: null };
      }
      if (p?.kind === 'error') return { fn: null, error: p.error ?? 'Invalid expression' };
      return { fn: null, error: 'Enter an expression in x (e.g. x^2 - 1)' };
    });
    // library is read inside libraryLines(); keep it as a dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.exprs, angle, library]);

  const range = useMemo(() => {
    const { start, end } = st;
    let step = st.step;
    if (![start, end, step].every(Number.isFinite)) return { xs: [] as number[], total: 0, error: 'Start, end and step must be finite numbers' };
    if (step === 0) return { xs: [], total: 0, error: 'Step must not be zero' };
    step = Math.abs(step) * (end < start ? -1 : 1);
    const total = Math.floor(Math.abs(end - start) / Math.abs(step) + 1e-9) + 1;
    const count = Math.min(total, MAX_ROWS);
    const xs: number[] = new Array(count);
    for (let i = 0; i < count; i++) {
      const x = Number((start + i * step).toPrecision(14));
      xs[i] = Math.abs(x) < Math.abs(step) * 1e-10 ? 0 : x;
    }
    return { xs, total, error: null as string | null };
  }, [st.start, st.end, st.step]);

  const cols = useMemo(() => compiled.map((c, i) => ({ i, fn: c.fn })).filter((c): c is { i: number; fn: (x: number) => number } => !!c.fn), [compiled]);

  const table = useMemo(() => {
    const { xs } = range;
    const ys = cols.map((c) => xs.map((x) => c.fn(x)));
    const marks = cols.map(() => new Array<Mark | null>(xs.length).fill(null));
    const features: Feature[] = [];
    cols.forEach((c, k) => {
      const y = ys[k];
      const m = marks[k];
      // pass 1: zeros, sign changes (refined roots) and discontinuities
      for (let i = 0; i < xs.length; i++) {
        const b = y[i];
        if (!Number.isFinite(b)) continue;
        if (b === 0) {
          m[i] = 'root';
          features.push({ fn: c.i, kind: 'root', x: xs[i], y: 0, row: i, exact: true });
          continue;
        }
        const a = i > 0 ? y[i - 1] : NaN;
        if (Number.isFinite(a) && a !== 0 && Math.sign(a) !== Math.sign(b)) {
          const r = bisectRoot(c.fn, xs[i - 1], xs[i], a);
          const fr = c.fn(r);
          const real = Number.isFinite(fr) && Math.abs(fr) <= Math.min(Math.abs(a), Math.abs(b));
          m[i] = real ? 'sign' : 'pole';
          if (real) features.push({ fn: c.i, kind: 'root', x: snap(r), y: 0, row: i });
        }
      }
      // pass 2: local extrema (not next to a discontinuity)
      for (let i = 1; i + 1 < xs.length; i++) {
        if (m[i] || m[i + 1] === 'pole') continue;
        const a = y[i - 1];
        const b = y[i];
        const cc = y[i + 1];
        if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(cc)) continue;
        const isMax = b > a && b >= cc && !(b === cc && i + 2 < xs.length && y[i + 2] > b);
        const isMin = b < a && b <= cc && !(b === cc && i + 2 < xs.length && y[i + 2] < b);
        if (!isMax && !isMin) continue;
        m[i] = isMax ? 'max' : 'min';
        const lo = Math.min(xs[i - 1], xs[i + 1]);
        const hi = Math.max(xs[i - 1], xs[i + 1]);
        let xe = snap(refineExtremum(c.fn, lo, hi, isMax));
        let ye = c.fn(xe);
        if (Number.isFinite(ye) && Math.abs(b - ye) <= 1e-12 * Math.max(1, Math.abs(b))) {
          xe = xs[i];
          ye = b;
        }
        const better = Number.isFinite(ye) && (isMax ? ye >= b : ye <= b);
        features.push({ fn: c.i, kind: isMax ? 'max' : 'min', x: better ? xe : xs[i], y: better ? snap(ye) : b, row: i });
      }
    });
    features.sort((p, q) => p.fn - q.fn || p.row - q.row);
    return { ys, marks, features };
  }, [range, cols]);

  const xr = useMemo<[number, number]>(() => {
    const { xs } = range;
    if (!xs.length) return [-5, 5];
    const lo = Math.min(xs[0], xs[xs.length - 1]);
    const hi = Math.max(xs[0], xs[xs.length - 1]);
    return lo === hi ? [lo - 1, hi + 1] : [lo, hi];
  }, [range]);

  const series = useMemo<Series[]>(() => {
    const s: Series[] = cols.map((c) => ({ type: 'fn', f: c.fn, color: CURVE_COLORS_LIGHT[c.i], label: NAMES[c.i] }));
    for (const c of cols) {
      const pts = table.features.filter((f) => f.fn === c.i).map((f) => [f.x, f.y] as [number, number]);
      if (pts.length) s.push({ type: 'points', pts: pts.slice(0, 200), color: CURVE_COLORS_LIGHT[c.i], r: 3.5 });
    }
    return s;
  }, [cols, table.features]);

  const header = ['x', ...cols.map((c) => `${NAMES[c.i]}(x)`)];
  const rowsData = () => range.xs.map((x, i) => [x, ...table.ys.map((y) => y[i])]);
  const csvHeader = ['x', ...cols.map((c) => `${NAMES[c.i]}(x) = ${stripHead(st.exprs[c.i].trim(), NAMES[c.i])}`)];

  const setExpr = (i: number, v: string) => {
    const exprs = st.exprs.slice();
    exprs[i] = v;
    set({ exprs });
  };

  const fmtFeature = (f: Feature) => (f.kind === 'root' ? `${NAMES[f.fn]} = 0 at x ${f.exact ? '=' : '≈'} ${fmt(f.x)}` : `${NAMES[f.fn]} ${f.kind} (${fmt(f.x)}, ${fmt(f.y)})`);

  return (
    <div className="tbl-layout">
      <section className="card card-pad stack" aria-label="Table settings">
        <div className="stack-sm">
          <div className="section-title" style={{ margin: 0 }}>
            Functions
          </div>
          {NAMES.map((name, i) => (
            <div key={name} className="stack-sm">
              <div className="tbl-fn-row">
                <label className="tbl-fn-name" htmlFor={`tbl-${name}`} style={{ ['--dot' as string]: colors[i] }}>
                  <span className="tbl-dot" aria-hidden="true" />
                  {name}(x)
                </label>
                <input
                  id={`tbl-${name}`}
                  className={`input mono${compiled[i].error ? ' invalid' : ''}`}
                  value={st.exprs[i]}
                  onChange={(e) => setExpr(i, e.target.value)}
                  placeholder={i === 0 ? 'e.g. x^2 - 2, sin(x), e^x' : i === 1 ? 'optional — may use f(x)' : 'optional — may use f(x), g(x)'}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="off"
                  aria-invalid={!!compiled[i].error}
                  aria-describedby={compiled[i].error ? `tbl-${name}-err` : undefined}
                />
              </div>
              {compiled[i].error && (
                <div id={`tbl-${name}-err`} className="error-text" role="alert">
                  {compiled[i].error}
                </div>
              )}
            </div>
          ))}
          <div className="small muted">
            Angle: {angle}. Library functions are available{libraryLines().length ? ` (${libraryLines().length} defined)` : ''}.
          </div>
        </div>
        <div className="stack-sm">
          <div className="section-title" style={{ margin: 0 }}>
            Range
          </div>
          <div className="tbl-range">
            <div className="field">
              <label htmlFor="tbl-start">Start</label>
              <NumberInput id="tbl-start" value={st.start} onChange={(start) => set({ start })} />
            </div>
            <div className="field">
              <label htmlFor="tbl-end">End</label>
              <NumberInput id="tbl-end" value={st.end} onChange={(end) => set({ end })} />
            </div>
            <div className="field">
              <label htmlFor="tbl-step">Step</label>
              <NumberInput id="tbl-step" value={st.step} onChange={(step) => set({ step })} placeholder="e.g. pi/6" />
            </div>
          </div>
          <div className="small muted">Expressions such as pi/6 or 1e-3 are accepted.</div>
          {range.error && <div className="error-text">{range.error}</div>}
        </div>
        {cols.length > 0 && (
          <div className="stack-sm">
            <div className="section-title" style={{ margin: 0 }}>
              Evaluate at any x
            </div>
            <div className="field">
              <label htmlFor="tbl-at">x =</label>
              <NumberInput id="tbl-at" value={st.at} onChange={(at) => set({ at })} />
            </div>
            <div className="stat-grid">
              {cols.map((c) => (
                <div className="stat" key={c.i}>
                  <div className="k">
                    {NAMES[c.i]}({fmt(st.at)})
                  </div>
                  <div className="v tbl-mono">{fmt(c.fn(st.at), 10)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="stack">
        {cols.length > 0 && range.xs.length > 0 && (
          <section className="card card-pad">
            <Plot series={series} x={xr} height={240} ariaLabel={`Plot of ${cols.map((c) => NAMES[c.i]).join(', ')} from ${fmt(xr[0])} to ${fmt(xr[1])}`} />
          </section>
        )}

        {table.features.length > 0 && (
          <section className="card card-pad stack-sm" aria-label="Roots and extrema">
            <div className="section-title" style={{ margin: 0 }}>
              Roots &amp; turning points (refined)
            </div>
            <div className="tbl-chips">
              {table.features.slice(0, 30).map((f, k) => (
                <button key={k} type="button" className="tbl-chip" style={{ ['--dot' as string]: colors[f.fn] }} onClick={() => flashRow(`tbl-fr-${f.row}`)} title="Show in table">
                  <span className="tbl-dot" aria-hidden="true" />
                  {fmtFeature(f)}
                </button>
              ))}
              {table.features.length > 30 && <span className="small muted">+{table.features.length - 30} more</span>}
            </div>
          </section>
        )}

        <section className="card card-pad stack-sm" aria-label="Table of values">
          <div className="tbl-toolbar">
            <span className="count">
              {range.xs.length.toLocaleString()} row{range.xs.length === 1 ? '' : 's'}
            </span>
            <span className="spacer" />
            <button className="btn btn-ghost btn-sm" disabled={!cols.length || !range.xs.length} onClick={() => copyText(toDelimited(header, rowsData(), '\t'), 'Table copied')}>
              <Copy size={14} /> Copy
            </button>
            <button className="btn btn-ghost btn-sm" disabled={!cols.length || !range.xs.length} onClick={() => downloadText('calci-table.csv', toDelimited(csvHeader, rowsData(), ','))}>
              <Download size={14} /> CSV
            </button>
          </div>
          {range.total > MAX_ROWS && (
            <div className="tbl-notice" role="status">
              Showing the first {MAX_ROWS.toLocaleString()} of {range.total.toLocaleString()} rows. Increase the step or narrow the range to see the rest.
            </div>
          )}
          <Legend />
          {cols.length === 0 ? (
            <div className="muted small">Enter at least one function to build a table.</div>
          ) : (
            <div className="table-wrap tbl-scroll" tabIndex={0} role="region" aria-label="Values table (scrollable)">
              <table className="table">
                <caption className="sr-only">Values of {cols.map((c) => `${NAMES[c.i]}(x)`).join(', ')}</caption>
                <thead>
                  <tr>
                    <th scope="col">x</th>
                    {cols.map((c) => (
                      <th scope="col" key={c.i}>
                        <span className="tbl-fn-name" style={{ ['--dot' as string]: colors[c.i] }}>
                          <span className="tbl-dot" aria-hidden="true" />
                          {NAMES[c.i]}(x)
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {range.xs.map((x, i) => (
                    <tr key={i} id={`tbl-fr-${i}`}>
                      <th scope="row" style={{ position: 'static', background: 'transparent', fontWeight: 500, color: 'var(--text-2)', textAlign: 'left' }}>
                        {fmt(x)}
                      </th>
                      {cols.map((c, k) => {
                        const mk = table.marks[k][i];
                        const info = mk ? MARK_INFO[mk] : null;
                        return (
                          <td key={c.i} className={info?.cls} title={info?.text}>
                            {info && (
                              <>
                                <span className="tbl-mark" aria-hidden="true">
                                  {info.glyph}
                                </span>
                                <span className="sr-only">{info.text}: </span>
                              </>
                            )}
                            {fmt(table.ys[k][i])}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="tbl-legend" aria-label="Highlight legend">
      <span>
        <i className="tbl-swatch root" aria-hidden="true" /> root / sign change
      </span>
      <span>
        <i className="tbl-swatch max" aria-hidden="true" /> local max
      </span>
      <span>
        <i className="tbl-swatch min" aria-hidden="true" /> local min
      </span>
      <span>
        <i className="tbl-swatch pole" aria-hidden="true" /> discontinuity
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ sequences */

const PRESETS: { label: string; seq: Partial<SeqState> }[] = [
  { label: 'Fibonacci', seq: { u: { expr: 'u(n-1) + u(n-2)', init: '1, 1' }, useV: false, nMin: 1, from: 1, to: 20 } },
  { label: 'Arithmetic: 3 + 4(n − 1)', seq: { u: { expr: '3 + 4(n-1)', init: '' }, useV: false, nMin: 1, from: 1, to: 15 } },
  { label: 'Geometric: 5·2^(n−1)', seq: { u: { expr: '5*2^(n-1)', init: '' }, useV: false, nMin: 1, from: 1, to: 15 } },
  { label: 'u(n) = 2u(n−1) + 1', seq: { u: { expr: '2u(n-1) + 1', init: '1' }, useV: false, nMin: 1, from: 1, to: 15 } },
  { label: 'Newton √2', seq: { u: { expr: '(u(n-1) + 2/u(n-1))/2', init: '1' }, useV: false, nMin: 1, from: 1, to: 10 } },
  { label: '(1 + 1/n)^n → e', seq: { u: { expr: '(1 + 1/n)^n', init: '' }, useV: false, nMin: 1, from: 1, to: 200 } },
  { label: 'Logistic map (r = 3.2)', seq: { u: { expr: '3.2 u(n-1)(1 - u(n-1))', init: '0.5' }, useV: false, nMin: 0, from: 0, to: 40 } },
  {
    label: 'Coupled: predator / prey',
    seq: {
      u: { expr: 'u(n-1) + 0.1u(n-1) - 0.002u(n-1)v(n-1)', init: '100' },
      v: { expr: 'v(n-1) - 0.2v(n-1) + 0.001u(n-1)v(n-1)', init: '20' },
      useV: true,
      nMin: 0,
      from: 0,
      to: 120,
    },
  },
  {
    label: 'Coupled: loan balance & interest',
    seq: { u: { expr: 'u(n-1)*1.01 - 200', init: '5000' }, v: { expr: 'v(n-1) + 0.01u(n-1)', init: '0' }, useV: true, nMin: 0, from: 0, to: 30 },
  },
];

function parseInitial(text: string, name: string): { values: number[]; error: string | null } {
  const parts = splitList(text);
  const values: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const v = parseNumber(parts[i]);
    if (!Number.isFinite(v)) return { values, error: `Initial term ${i + 1} of ${name} (“${parts[i]}”) is not a number` };
    values.push(v);
  }
  return { values, error: null };
}

function SequenceTab({ st, set }: { st: SeqState; set: (p: Partial<SeqState>) => void }) {
  const angle = useStore((s) => s.calc.angle);
  const library = useStore((s) => s.library);
  const colors = useCurveColors();

  const initU = useMemo(() => parseInitial(st.u.init, 'u'), [st.u.init]);
  const initV = useMemo(() => parseInitial(st.v.init, 'v'), [st.v.init]);

  const result: SequenceResult | null = useMemo(() => {
    if (initU.error || (st.useV && initV.error)) return null;
    return evaluateSequence(
      {
        u: { expr: st.u.expr, initial: initU.values },
        v: st.useV ? { expr: st.v.expr, initial: initV.values } : null,
        nMin: st.nMin,
        angle,
        library: libraryLines(),
      },
      st.from,
      st.to,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.u.expr, st.v.expr, st.useV, st.nMin, st.from, st.to, initU, initV, angle, library]);

  const ok = result && !result.error ? result : null;
  const sums = useMemo(() => (ok ? { u: partialSums(ok.u), v: ok.v ? partialSums(ok.v) : null } : null), [ok]);
  const analysis = useMemo(() => {
    if (!ok) return null;
    const one = (terms: number[]) => ({ prog: detectProgression(terms), hint: convergenceHint(terms) });
    return { u: one(ok.u), v: ok.v ? one(ok.v) : null };
  }, [ok]);

  const series = useMemo<Series[]>(() => {
    if (!ok) return [];
    const mk = (vals: number[]) => ok.n.map((n, i) => [n, vals[i]] as [number, number]).filter((p) => Number.isFinite(p[1]));
    const s: Series[] = [];
    const add = (vals: number[], ci: number, label: string) => {
      const pts = mk(vals);
      if (st.connect) s.push({ type: 'line', pts, color: CURVE_COLORS_LIGHT[ci], width: 1.25, label });
      s.push({ type: 'points', pts, color: CURVE_COLORS_LIGHT[ci], r: ok.n.length > 400 ? 1.5 : 3, label });
    };
    add(ok.u, 0, 'u');
    if (ok.v) add(ok.v, 1, 'v');
    return s;
  }, [ok, st.connect]);

  const xr = useMemo<[number, number]>(() => {
    if (!ok || !ok.n.length) return [0, 10];
    const a = ok.n[0];
    const b = ok.n[ok.n.length - 1];
    const pad = Math.max(0.5, (b - a) * 0.02);
    return [a - pad, b + pad];
  }, [ok]);

  const header = ['n', 'u(n)', 'Σu', ...(ok?.v ? ['v(n)', 'Σv'] : [])];
  const rowsData = () =>
    ok ? ok.n.map((n, i) => [n, ok.u[i], sums!.u[i], ...(ok.v ? [ok.v[i], sums!.v![i]] : [])]) : [];

  const shown = ok ? Math.min(ok.n.length, MAX_ROWS) : 0;
  const error = initU.error ?? (st.useV ? initV.error : null) ?? result?.error ?? null;

  const kindBadge = (name: 'u' | 'v') => {
    const info = result?.info[name];
    if (!info) return null;
    return (
      <span className={`badge${info.kind === 'recursive' ? ' accent' : ''}`}>
        {info.kind === 'recursive' ? `recursive · ${info.needs} initial term${info.needs === 1 ? '' : 's'}` : 'explicit'}
      </span>
    );
  };

  const slot = (name: 'u' | 'v') => {
    const s = st[name];
    const update = (p: Partial<SeqSlot>) => set({ [name]: { ...s, ...p } } as Partial<SeqState>);
    return (
      <div className="stack-sm">
        <div className="tbl-seq-head">
          <span className="tbl-fn-name" style={{ ['--dot' as string]: colors[name === 'u' ? 0 : 1] }}>
            <span className="tbl-dot" aria-hidden="true" />
            {name}(n)
          </span>
          {kindBadge(name)}
        </div>
        <div className="tbl-seq-grid">
          <div className="field">
            <label htmlFor={`seq-${name}`}>{name}(n) =</label>
            <input
              id={`seq-${name}`}
              className="input mono"
              value={s.expr}
              onChange={(e) => update({ expr: e.target.value })}
              placeholder={name === 'u' ? 'e.g. 2n+1 or u(n-1)+u(n-2)' : 'e.g. v(n-1) + u(n-1)'}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor={`seq-${name}-init`}>
              Initial {name}({fmt(st.nMin)}), {name}({fmt(st.nMin + 1)}), …
            </label>
            <input
              id={`seq-${name}-init`}
              className="input mono"
              value={s.init}
              onChange={(e) => update({ init: e.target.value })}
              placeholder="e.g. 1, 1"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        </div>
      </div>
    );
  };

  const statTiles = (name: 'u' | 'v'): ReactNode => {
    if (!ok || !analysis || !sums) return null;
    const a = analysis[name];
    const terms = name === 'u' ? ok.u : ok.v;
    const sum = name === 'u' ? sums.u : sums.v;
    if (!a || !terms || !sum || !terms.length) return null;
    const p = a.prog;
    const typeText = p ? (p.type === 'arithmetic' ? `Arithmetic, d = ${fmt(p.d, 12)}` : `Geometric, r = ${fmt(p.r, 12)}`) : 'Neither arithmetic nor geometric';
    return (
      <>
        <div className="stat tbl-wrap">
          <div className="k">{name}: type</div>
          <div className="v" title={typeText}>
            {typeText}
          </div>
        </div>
        <div className="stat">
          <div className="k">
            Σ{name}, n = {ok.n[0]}…{ok.n[ok.n.length - 1]}
          </div>
          <div className="v tbl-mono">{fmt(sum[sum.length - 1], 12)}</div>
        </div>
        <div className="stat tbl-wrap">
          <div className="k">{name}: trend</div>
          <div className="v" title={a.hint.message}>
            {a.hint.message}
          </div>
        </div>
        {p && (
          <div className="stat tbl-stat-wide">
            <div className="k">General term</div>
            <div className="v">{progressionFormula(p, ok.n[0], name)}</div>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="tbl-layout">
      <section className="card card-pad stack" aria-label="Sequence settings">
        <div className="field">
          <label htmlFor="seq-preset">Examples</label>
          <select
            id="seq-preset"
            className="input select"
            value=""
            onChange={(e) => {
              const p = PRESETS[Number(e.target.value)];
              if (p) set({ v: { expr: '', init: '' }, ...p.seq });
            }}
          >
            <option value="" disabled>
              Load an example…
            </option>
            {PRESETS.map((p, i) => (
              <option key={i} value={i}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        {slot('u')}
        <label className="checkbox">
          <input type="checkbox" checked={st.useV} onChange={(e) => set({ useV: e.target.checked })} />
          Second sequence v(n) (may refer to u, and u to v)
        </label>
        {st.useV && slot('v')}
        <div className="tbl-range">
          <div className="field">
            <label htmlFor="seq-nmin">First index n₀</label>
            <NumberInput id="seq-nmin" value={st.nMin} onChange={(nMin) => set({ nMin: Math.round(nMin) })} />
          </div>
          <div className="field">
            <label htmlFor="seq-from">Show n from</label>
            <NumberInput id="seq-from" value={st.from} onChange={(from) => set({ from: Math.round(from) })} />
          </div>
          <div className="field">
            <label htmlFor="seq-to">to</label>
            <NumberInput id="seq-to" value={st.to} onChange={(to) => set({ to: Math.round(to) })} />
          </div>
        </div>
        <div className="small muted">
          Use n as the index. Recursive terms: u(n-1), u(n-2), v(n-1)… Initial terms are used only by recursive definitions. Up to {MAX_SEQUENCE_TERMS.toLocaleString()} terms. Angle: {angle}.
        </div>
        {error && (
          <div className="error-text" role="alert">
            {error}
          </div>
        )}
        {ok?.warnings.map((w, i) => (
          <div key={i} className="tbl-notice" role="status">
            {w}
          </div>
        ))}
      </section>

      <div className="stack">
        {ok && ok.n.length > 0 && (
          <section className="card card-pad stack-sm">
            <div className="stat-grid">
              {statTiles('u')}
              {statTiles('v')}
            </div>
          </section>
        )}
        {ok && ok.n.length > 0 && (
          <section className="card card-pad stack-sm">
            <div className="row">
              <div className="section-title" style={{ margin: 0 }}>
                Terms
              </div>
              <span className="spacer" />
              <label className="checkbox">
                <input type="checkbox" checked={st.connect} onChange={(e) => set({ connect: e.target.checked })} />
                Connect points
              </label>
            </div>
            <Plot series={series} x={xr} height={240} ariaLabel={`Plot of the terms of ${ok.v ? 'u(n) and v(n)' : 'u(n)'} for n from ${ok.n[0]} to ${ok.n[ok.n.length - 1]}`} xLabel="n" />
          </section>
        )}
        <section className="card card-pad stack-sm" aria-label="Sequence table">
          <div className="tbl-toolbar">
            <Sigma size={15} aria-hidden="true" />
            <span className="count">
              {ok ? `${ok.n.length.toLocaleString()} term${ok.n.length === 1 ? '' : 's'}` : 'No terms'}
            </span>
            <span className="spacer" />
            <button className="btn btn-ghost btn-sm" disabled={!ok?.n.length} onClick={() => copyText(toDelimited(header, rowsData(), '\t'), 'Table copied')}>
              <Copy size={14} /> Copy
            </button>
            <button className="btn btn-ghost btn-sm" disabled={!ok?.n.length} onClick={() => downloadText('calci-sequence.csv', toDelimited(header, rowsData(), ','))}>
              <Download size={14} /> CSV
            </button>
          </div>
          {ok && ok.n.length > MAX_ROWS && (
            <div className="tbl-notice" role="status">
              Showing the first {MAX_ROWS.toLocaleString()} of {ok.n.length.toLocaleString()} terms. Export CSV to get all of them.
            </div>
          )}
          {ok && ok.n.length > 0 && (
            <div className="table-wrap tbl-scroll" tabIndex={0} role="region" aria-label="Sequence terms (scrollable)">
              <table className="table">
                <caption className="sr-only">Terms and partial sums of {ok.v ? 'u(n) and v(n)' : 'u(n)'}</caption>
                <thead>
                  <tr>
                    <th scope="col">n</th>
                    <th scope="col">u(n)</th>
                    <th scope="col" title={`Running sum from n = ${ok.n[0]}`}>
                      Σu
                    </th>
                    {ok.v && (
                      <>
                        <th scope="col">v(n)</th>
                        <th scope="col" title={`Running sum from n = ${ok.n[0]}`}>
                          Σv
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {ok.n.slice(0, shown).map((n, i) => (
                    <tr key={n}>
                      <td className="n">{n}</td>
                      <td>{fmt(ok.u[i])}</td>
                      <td className="sum">{fmt(sums!.u[i])}</td>
                      {ok.v && (
                        <>
                          <td>{fmt(ok.v[i])}</td>
                          <td className="sum">{fmt(sums!.v![i])}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
