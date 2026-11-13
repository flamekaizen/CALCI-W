import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, ClipboardPaste, ChartSpline } from 'lucide-react';
import { stats, distributions as D } from '../../core/index';
import type { RegressionModel, Tail, TestResult } from '../../core/stats';
import { useStore, nextColor, uid } from '../store';
import { navigate } from '../router';
import { Tabs, Tex, NumberInput, Segmented, fmt, toast, parseNumber } from '../ui';
import { Plot, type Series } from '../components/Plot';
import '../../styles/modes/tools.css';

type Tab = 'data' | 'regression' | 'dist' | 'tests';
interface Row {
  x: string;
  y: string;
  f: string;
}
const KEY = 'calci-stats-v1';
const SAMPLE: Row[] = [
  [1, 2.1], [2, 3.9], [3, 6.2], [4, 7.8], [5, 10.1], [6, 12.2], [7, 13.8], [8, 16.1], [9, 18.3], [10, 19.7],
].map(([x, y]) => ({ x: String(x), y: String(y), f: '1' }));

function loadRows(): Row[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '');
    if (Array.isArray(v) && v.length) return v;
  } catch {
    /* ignore */
  }
  return SAMPLE;
}

export default function Statistics() {
  const [tab, setTab] = useState<Tab>('data');
  const [rows, setRows] = useState<Row[]>(loadRows);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(rows));
    } catch {
      /* ignore */
    }
  }, [rows]);
  return (
    <div className="page wide">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'data', label: 'Data & summary' },
          { id: 'regression', label: 'Regression' },
          { id: 'dist', label: 'Distributions' },
          { id: 'tests', label: 'Tests & intervals' },
        ]}
      />
      {tab === 'data' && <DataTab rows={rows} setRows={setRows} />}
      {tab === 'regression' && <RegressionTab rows={rows} setRows={setRows} />}
      {tab === 'dist' && <DistTab />}
      {tab === 'tests' && <TestsTab rows={rows} />}
    </div>
  );
}

function cols(rows: Row[]) {
  const x: number[] = [];
  const y: number[] = [];
  const f: number[] = [];
  for (const r of rows) {
    const xv = parseNumber(r.x);
    if (!Number.isFinite(xv)) continue;
    x.push(xv);
    y.push(parseNumber(r.y));
    const fv = parseNumber(r.f || '1');
    f.push(Number.isFinite(fv) ? fv : 1);
  }
  return { x, y, f };
}

function DataTable({ rows, setRows, showY = true, showF = false }: { rows: Row[]; setRows: (r: Row[]) => void; showY?: boolean; showF?: boolean }) {
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState('');
  const set = (i: number, k: keyof Row, v: string) => {
    const n = rows.slice();
    n[i] = { ...n[i], [k]: v };
    if (i === rows.length - 1 && v) n.push({ x: '', y: '', f: '1' });
    setRows(n);
  };
  const display = rows.length && rows[rows.length - 1].x === '' ? rows : [...rows, { x: '', y: '', f: '1' }];
  const onPasteImport = () => {
    const lines = text.trim().split(/\r?\n/);
    const parsed: Row[] = [];
    for (const l of lines) {
      const parts = l.split(/[,\t; ]+/).filter(Boolean);
      if (!parts.length || Number.isNaN(Number(parts[0]))) continue;
      parsed.push({ x: parts[0], y: parts[1] ?? '', f: parts[2] ?? '1' });
    }
    if (!parsed.length) {
      toast('No numeric rows found');
      return;
    }
    setRows(parsed);
    setPaste(false);
    setText('');
    toast(`Imported ${parsed.length} rows`);
  };
  return (
    <div className="stack-sm">
      <div className="row">
        <button className="btn btn-ghost btn-sm" onClick={() => setPaste((p) => !p)}>
          <ClipboardPaste size={14} /> Paste / CSV
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setRows([{ x: '', y: '', f: '1' }])}>
          <Trash2 size={14} /> Clear
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setRows(SAMPLE)}>
          Sample data
        </button>
      </div>
      {paste && (
        <div className="stack-sm">
          <textarea className="textarea mono" value={text} onChange={(e) => setText(e.target.value)} placeholder={'One row per line: x, y, frequency\n1, 2.1\n2, 3.9'} rows={6} />
          <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={onPasteImport}>
            Import
          </button>
        </div>
      )}
      <div className="data-scroll table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>X</th>
              {showY && <th>Y</th>}
              {showF && <th>Freq</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {display.map((r, i) => (
              <tr key={i}>
                <td className="idx">{i + 1}</td>
                <td>
                  <input className="cell-input" value={r.x} onChange={(e) => set(i, 'x', e.target.value)} aria-label={`X ${i + 1}`} inputMode="decimal" />
                </td>
                {showY && (
                  <td>
                    <input className="cell-input" value={r.y} onChange={(e) => set(i, 'y', e.target.value)} aria-label={`Y ${i + 1}`} inputMode="decimal" />
                  </td>
                )}
                {showF && (
                  <td>
                    <input className="cell-input" value={r.f} onChange={(e) => set(i, 'f', e.target.value)} aria-label={`Frequency ${i + 1}`} inputMode="numeric" />
                  </td>
                )}
                <td style={{ width: 32 }}>
                  {i < rows.length && (
                    <button className="icon-btn sm" onClick={() => setRows(rows.filter((_, k) => k !== i))} aria-label={`Delete row ${i + 1}`}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setRows([...rows, { x: '', y: '', f: '1' }])}>
        <Plus size={14} /> Row
      </button>
    </div>
  );
}

function DataTab({ rows, setRows }: { rows: Row[]; setRows: (r: Row[]) => void }) {
  const [useFreq, setUseFreq] = useState(false);
  const [column, setColumn] = useState<'x' | 'y'>('x');
  const { x, y, f } = cols(rows);
  const values = column === 'x' ? x : y.filter(Number.isFinite);
  const d = useMemo(() => (values.length ? stats.describe(values, useFreq && column === 'x' ? f : undefined) : null), [values.join(','), useFreq, f.join(','), column]);
  const expanded = useFreq && column === 'x' ? stats.expand(values, f) : values;
  const hist = stats.histogram(expanded);
  const tiles: [string, number | string][] = d
    ? [
        ['n', d.n], ['Mean x̄', d.mean], ['Median', d.median], ['Mode', d.modes.length ? d.modes.map((m) => fmt(m)).join(', ') : 'none'],
        ['Std dev (sample) s', d.sdSample], ['Std dev (pop.) σ', d.sdPop], ['Variance s²', d.varianceSample], ['Variance σ²', d.variancePop],
        ['Min', d.min], ['Q1', d.q1], ['Q3', d.q3], ['Max', d.max], ['Range', d.range], ['IQR', d.iqr], ['Σx', d.sum], ['Σx²', d.sumSq],
        ['Std error', d.sem], ['Skewness', d.skewness], ['Excess kurtosis', d.kurtosis], ['Geometric mean', d.geometricMean], ['Harmonic mean', d.harmonicMean], ['Coeff. of variation', d.cv],
      ]
    : [];
  return (
    <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 0.8fr) minmax(0, 1.2fr)', alignItems: 'start' }}>
      <section className="card card-pad stack-sm">
        <label className="checkbox">
          <input type="checkbox" checked={useFreq} onChange={(e) => setUseFreq(e.target.checked)} />
          Use a frequency column
        </label>
        <DataTable rows={rows} setRows={setRows} showF={useFreq} />
      </section>
      <section className="stack">
        <div className="card card-pad stack-sm">
          <div className="row">
            <div className="section-title" style={{ margin: 0 }}>
              One-variable statistics
            </div>
            <div className="spacer" />
            <Segmented
              size="sm"
              value={column}
              onChange={setColumn}
              options={[
                { value: 'x', label: 'X' },
                { value: 'y', label: 'Y' },
              ]}
            />
          </div>
          {!d ? (
            <div className="empty">Enter some numbers to see statistics.</div>
          ) : (
            <div className="stat-grid">
              {tiles.map(([k, v]) => (
                <div className="stat" key={k}>
                  <div className="k">{k}</div>
                  <div className="v">{typeof v === 'number' ? fmt(v) : v}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {d && hist.length > 0 && (
          <div className="card card-pad stack-sm">
            <div className="section-title">Histogram & box plot</div>
            <Plot
              x={[hist[0].x0 - (hist[0].x1 - hist[0].x0) * 0.5, hist[hist.length - 1].x1 + (hist[0].x1 - hist[0].x0) * 0.5]}
              y={[-Math.max(...hist.map((h) => h.count)) * 0.35, Math.max(...hist.map((h) => h.count)) * 1.1]}
              series={[
                { type: 'bars', bars: hist.map((h) => ({ x0: h.x0, x1: h.x1, y: h.count })), color: '#4F46E5', opacity: 0.6 },
                ...boxPlot(d, -Math.max(...hist.map((h) => h.count)) * 0.18),
              ]}
              height={260}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function boxPlot(d: stats.Descriptive, y: number): Series[] {
  const h = Math.abs(y) * 0.5;
  const c = '#E11D48';
  return [
    { type: 'line', pts: [[d.min, y], [d.q1, y]], color: c, width: 1.5 },
    { type: 'line', pts: [[d.q3, y], [d.max, y]], color: c, width: 1.5 },
    { type: 'line', pts: [[d.q1, y - h], [d.q3, y - h], [d.q3, y + h], [d.q1, y + h], [d.q1, y - h]], color: c, width: 1.5 },
    { type: 'line', pts: [[d.median, y - h], [d.median, y + h]], color: c, width: 2.5 },
    { type: 'line', pts: [[d.min, y - h / 2], [d.min, y + h / 2]], color: c, width: 1.5 },
    { type: 'line', pts: [[d.max, y - h / 2], [d.max, y + h / 2]], color: c, width: 1.5 },
  ];
}

function RegressionTab({ rows, setRows }: { rows: Row[]; setRows: (r: Row[]) => void }) {
  const [model, setModel] = useState<RegressionModel>('linear');
  const [px, setPx] = useState(12);
  const { x, y } = cols(rows);
  const pairs = x.map((v, i) => [v, y[i]] as [number, number]).filter(([, b]) => Number.isFinite(b));
  const reg = useMemo(() => {
    try {
      return { r: stats.regress(pairs.map((p) => p[0]), pairs.map((p) => p[1]), model), error: null };
    } catch (e) {
      return { r: null, error: (e as Error).message };
    }
  }, [JSON.stringify(pairs), model]);
  const xs = pairs.map((p) => p[0]);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const pad = (hi - lo || 1) * 0.15;
  const addExpr = useStore((s) => s.addExpr);
  const sendToGraph = () => {
    if (!reg.r) return;
    const g = useStore.getState().graph;
    const pts = pairs.map(([a, b]) => `(${a}, ${b})`).join(', ');
    useStore.getState().setGraph({
      exprs: [...g.exprs.filter((e) => e.text.trim()), { id: uid(), text: pts, color: nextColor(g.exprs) }],
    });
    addExpr(`y = ${reg.r.expression}`);
    useStore.getState().setView({ cx: (lo + hi) / 2, cy: (Math.min(...pairs.map((p) => p[1])) + Math.max(...pairs.map((p) => p[1]))) / 2, xspan: (hi - lo + 2 * pad) * 1.3, yspan: (Math.max(...pairs.map((p) => p[1])) - Math.min(...pairs.map((p) => p[1])) || 1) * 1.5 });
    navigate('graph');
  };
  return (
    <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 0.8fr) minmax(0, 1.2fr)', alignItems: 'start' }}>
      <section className="card card-pad stack-sm">
        <DataTable rows={rows} setRows={setRows} />
      </section>
      <section className="stack">
        <div className="card card-pad stack-sm">
          <div className="op-grid">
            {stats.REGRESSION_MODELS.map((m) => (
              <button key={m.id} className={`btn btn-sm ${model === m.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setModel(m.id)} title={m.form}>
                {m.label}
              </button>
            ))}
          </div>
          {reg.error && <div className="error-text">{reg.error}</div>}
          {reg.r && (
            <>
              <div className="result-box accent">
                <div className="result-label">{stats.REGRESSION_MODELS.find((m) => m.id === model)!.form}</div>
                <div className="result-value" style={{ fontSize: 17 }}>
                  {reg.r.equation}
                </div>
              </div>
              <div className="stat-grid">
                {Object.entries(reg.r.params).map(([k, v]) => (
                  <div className="stat" key={k}>
                    <div className="k">{k}</div>
                    <div className="v">{fmt(v, 10)}</div>
                  </div>
                ))}
                <div className="stat">
                  <div className="k">r² (coefficient of determination)</div>
                  <div className="v">{fmt(reg.r.r2, 8)}</div>
                </div>
                {reg.r.r !== undefined && (
                  <div className="stat">
                    <div className="k">r (correlation)</div>
                    <div className="v">{fmt(reg.r.r, 8)}</div>
                  </div>
                )}
                <div className="stat">
                  <div className="k">n</div>
                  <div className="v">{reg.r.n}</div>
                </div>
              </div>
              <div className="row">
                <span className="label">Predict y at x =</span>
                <div style={{ width: 110 }}>
                  <NumberInput value={px} onChange={setPx} />
                </div>
                <strong className="num">ŷ = {fmt(reg.r.predict(px), 10)}</strong>
                <div className="spacer" />
                <button className="btn btn-secondary btn-sm" onClick={sendToGraph}>
                  <ChartSpline size={14} /> Send to graph
                </button>
              </div>
            </>
          )}
        </div>
        {pairs.length > 0 && (
          <div className="card card-pad">
            <Plot
              x={[lo - pad, hi + pad]}
              series={[
                { type: 'points', pts: pairs, color: '#4F46E5', r: 4.5 },
                ...(reg.r ? [{ type: 'fn' as const, f: reg.r.predict, color: '#E11D48', label: 'fit' }] : []),
              ]}
              height={320}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function DistTab() {
  const [id, setId] = useState('normal');
  const dist = D.DISTRIBUTIONS.find((d) => d.id === id)!;
  const [params, setParams] = useState<Record<string, number[]>>({});
  const p = params[id] ?? dist.params.map((q) => q.default);
  const [lo, setLo] = useState(-1);
  const [hi, setHi] = useState(1);
  const [q, setQ] = useState(0.95);
  const [mode, setMode] = useState<'between' | 'below' | 'above'>('between');
  const a = mode === 'below' ? -Infinity : lo;
  const b = mode === 'above' ? Infinity : hi;
  const prob = useMemo(() => {
    const cdf = (x: number) => (x === Infinity ? 1 : x === -Infinity ? 0 : dist.cdf(x, p));
    if (dist.discrete) {
      const ia = Number.isFinite(a) ? Math.ceil(a) : -Infinity;
      const ib = Number.isFinite(b) ? Math.floor(b) : Infinity;
      return cdf(ib) - (Number.isFinite(ia) ? cdf(ia - 1) : 0);
    }
    return cdf(b) - cdf(a);
  }, [a, b, p.join(','), id]);
  const [s0, s1] = dist.support(p);
  const inv = dist.inv ? dist.inv(q, p) : NaN;
  const series: Series[] = dist.discrete
    ? [
        {
          type: 'bars',
          bars: Array.from({ length: Math.min(400, Math.floor(s1) - Math.ceil(s0) + 1) }, (_, k) => {
            const xv = Math.ceil(s0) + k;
            return { x0: xv - 0.4, x1: xv + 0.4, y: dist.pdf(xv, p) };
          }),
          color: '#94A3B8',
          opacity: 0.5,
        },
        {
          type: 'bars',
          bars: Array.from({ length: Math.min(400, Math.floor(s1) - Math.ceil(s0) + 1) }, (_, k) => Math.ceil(s0) + k)
            .filter((xv) => xv >= a && xv <= b)
            .map((xv) => ({ x0: xv - 0.4, x1: xv + 0.4, y: dist.pdf(xv, p) })),
          color: '#4F46E5',
          opacity: 0.85,
        },
      ]
    : [
        { type: 'area', f: (x) => dist.pdf(x, p), a: Math.max(a, s0 - 10 * (s1 - s0)), b: Math.min(b, s1 + 10 * (s1 - s0)), color: '#4F46E5', opacity: 0.3 },
        { type: 'fn', f: (x) => dist.pdf(x, p), color: '#4F46E5', label: 'pdf' },
      ];
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="card card-pad stack">
        <div className="op-grid">
          {D.DISTRIBUTIONS.map((d) => (
            <button key={d.id} className={`btn btn-sm ${id === d.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setId(d.id)}>
              {d.name}
            </button>
          ))}
        </div>
        <div className="field-row">
          {dist.params.map((par, i) => (
            <div className="field" key={par.key}>
              <label>{par.label}</label>
              <NumberInput
                value={p[i]}
                onChange={(v) => {
                  const n = p.slice();
                  n[i] = v;
                  setParams({ ...params, [id]: n });
                }}
              />
            </div>
          ))}
        </div>
        <Segmented
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'between', label: 'P(a ≤ X ≤ b)' },
            { value: 'below', label: 'P(X ≤ b)' },
            { value: 'above', label: 'P(X ≥ a)' },
          ]}
        />
        <div className="field-row">
          {mode !== 'below' && (
            <div className="field">
              <label>a</label>
              <NumberInput value={lo} onChange={setLo} />
            </div>
          )}
          {mode !== 'above' && (
            <div className="field">
              <label>b</label>
              <NumberInput value={hi} onChange={setHi} />
            </div>
          )}
        </div>
        <div className="result-box accent">
          <div className="result-label">Probability</div>
          <div className="result-value num">{fmt(prob, 10)}</div>
        </div>
        <div className="stat-grid">
          <div className="stat">
            <div className="k">Mean</div>
            <div className="v">{fmt(dist.mean(p))}</div>
          </div>
          <div className="stat">
            <div className="k">Variance</div>
            <div className="v">{fmt(dist.variance(p))}</div>
          </div>
          <div className="stat">
            <div className="k">Std deviation</div>
            <div className="v">{fmt(Math.sqrt(dist.variance(p)))}</div>
          </div>
        </div>
        {dist.inv && (
          <div className="row">
            <span className="label">Inverse: x with P(X ≤ x) =</span>
            <div style={{ width: 100 }}>
              <NumberInput value={q} onChange={setQ} />
            </div>
            <strong className="num">x = {fmt(inv, 10)}</strong>
          </div>
        )}
      </section>
      <section className="card card-pad">
        <Plot x={[s0, s1]} series={series} height={340} pad={0.04} />
      </section>
    </div>
  );
}

const TESTS = [
  { id: 'z', label: '1-sample z' },
  { id: 't', label: '1-sample t' },
  { id: 't2', label: '2-sample t' },
  { id: 'p1', label: '1-proportion z' },
  { id: 'p2', label: '2-proportion z' },
  { id: 'chi', label: 'χ² goodness of fit' },
  { id: 'ci', label: 'Confidence intervals' },
] as const;

function TestsTab({ rows }: { rows: Row[] }) {
  const [test, setTest] = useState<(typeof TESTS)[number]['id']>('t');
  const [tail, setTail] = useState<Tail>('two');
  const [v, setV] = useState<Record<string, number>>({ mean: 5.5, sd: 1.2, n: 30, mu0: 5, sigma: 1.2, m2: 5.1, s2: 1.4, n2: 28, x: 56, p0: 0.5, x2: 40, level: 0.95 });
  const [obs, setObs] = useState('18, 22, 25, 35');
  const [exp, setExp] = useState('25, 25, 25, 25');
  const [pooled, setPooled] = useState(false);
  const num = (k: string, label: string) => (
    <div className="field" key={k}>
      <label>{label}</label>
      <NumberInput value={v[k]} onChange={(val) => setV({ ...v, [k]: val })} />
    </div>
  );
  const fromData = () => {
    const { x } = cols(rows);
    if (x.length < 2) {
      toast('Enter data in the Data tab first');
      return;
    }
    const d = stats.describe(x);
    setV({ ...v, mean: d.mean, sd: d.sdSample, n: d.n });
    toast('Loaded mean, s and n from data column X');
  };
  let result: TestResult | null = null;
  let error: string | null = null;
  let ci: { label: string; lo: number; hi: number }[] = [];
  try {
    switch (test) {
      case 'z':
        result = stats.zTest(v.mean, v.sigma, v.n, v.mu0, tail);
        break;
      case 't':
        result = stats.tTest(v.mean, v.sd, v.n, v.mu0, tail);
        break;
      case 't2':
        result = stats.twoSampleT(v.mean, v.sd, v.n, v.m2, v.s2, v.n2, tail, pooled);
        break;
      case 'p1':
        result = stats.onePropZ(v.x, v.n, v.p0, tail);
        break;
      case 'p2':
        result = stats.twoPropZ(v.x, v.n, v.x2, v.n2, tail);
        break;
      case 'chi': {
        const o = obs.split(/[,\s]+/).filter(Boolean).map(Number);
        const e = exp.split(/[,\s]+/).filter(Boolean).map(Number);
        if (o.length !== e.length || o.length < 2) throw new Error('Observed and expected need the same number of categories (at least 2)');
        result = stats.chiSquareGOF(o, e);
        break;
      }
      case 'ci': {
        const z = stats.zInterval(v.mean, v.sigma, v.n, v.level);
        const t = stats.tInterval(v.mean, v.sd, v.n, v.level);
        const pr = stats.propInterval(v.x, v.n, v.level);
        ci = [
          { label: `z-interval for μ (σ known)`, lo: z.lower, hi: z.upper },
          { label: `t-interval for μ (df = ${t.df})`, lo: t.lower, hi: t.upper },
          { label: `Interval for proportion p̂ = x/n`, lo: pr.lower, hi: pr.upper },
        ];
        break;
      }
    }
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="card card-pad stack">
        <div className="op-grid">
          {TESTS.map((t) => (
            <button key={t.id} className={`btn btn-sm ${test === t.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTest(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {test !== 'chi' && test !== 'ci' && (
          <Segmented
            size="sm"
            value={tail}
            onChange={setTail}
            options={[
              { value: 'two', label: 'H₁: ≠' },
              { value: 'left', label: 'H₁: <' },
              { value: 'right', label: 'H₁: >' },
            ]}
          />
        )}
        <div className="field-row">
          {test === 'z' && [num('mean', 'Sample mean x̄'), num('sigma', 'Population σ'), num('n', 'n'), num('mu0', 'Hypothesised μ₀')]}
          {test === 't' && [num('mean', 'Sample mean x̄'), num('sd', 'Sample s'), num('n', 'n'), num('mu0', 'Hypothesised μ₀')]}
          {test === 't2' && [num('mean', 'x̄₁'), num('sd', 's₁'), num('n', 'n₁'), num('m2', 'x̄₂'), num('s2', 's₂'), num('n2', 'n₂')]}
          {test === 'p1' && [num('x', 'Successes x'), num('n', 'n'), num('p0', 'Hypothesised p₀')]}
          {test === 'p2' && [num('x', 'x₁'), num('n', 'n₁'), num('x2', 'x₂'), num('n2', 'n₂')]}
          {test === 'ci' && [num('mean', 'x̄'), num('sigma', 'σ (for z)'), num('sd', 's (for t)'), num('n', 'n'), num('x', 'Successes x'), num('level', 'Confidence level')]}
        </div>
        {test === 't2' && (
          <label className="checkbox">
            <input type="checkbox" checked={pooled} onChange={(e) => setPooled(e.target.checked)} />
            Pooled variance (assume equal variances)
          </label>
        )}
        {test === 'chi' && (
          <>
            <div className="field">
              <label>Observed counts</label>
              <input className="input mono" value={obs} onChange={(e) => setObs(e.target.value)} />
            </div>
            <div className="field">
              <label>Expected counts</label>
              <input className="input mono" value={exp} onChange={(e) => setExp(e.target.value)} />
            </div>
          </>
        )}
        {(test === 'z' || test === 't' || test === 'ci') && (
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={fromData}>
            Use data from the table
          </button>
        )}
      </section>
      <section className="card card-pad stack">
        {error && <div className="error-text">{error}</div>}
        {result && (
          <>
            <div className={`result-box ${result.rejectAt05 ? 'accent' : ''}`}>
              <div className="result-label">Decision at α = 0.05</div>
              <div className="result-value" style={{ fontSize: 17 }}>
                {result.rejectAt05 ? 'Reject H₀ — the result is statistically significant' : 'Fail to reject H₀ — not statistically significant'}
              </div>
            </div>
            <div className="stat-grid">
              <div className="stat">
                <div className="k">Test statistic {result.statName}</div>
                <div className="v">{fmt(result.statistic, 8)}</div>
              </div>
              <div className="stat">
                <div className="k">p-value</div>
                <div className="v">{fmt(result.p, 8)}</div>
              </div>
              {result.df !== undefined && (
                <div className="stat">
                  <div className="k">Degrees of freedom</div>
                  <div className="v">{fmt(result.df, 6)}</div>
                </div>
              )}
              {result.estimate !== undefined && (
                <div className="stat">
                  <div className="k">Estimate</div>
                  <div className="v">{fmt(result.estimate, 8)}</div>
                </div>
              )}
              {result.se !== undefined && (
                <div className="stat">
                  <div className="k">Standard error</div>
                  <div className="v">{fmt(result.se, 8)}</div>
                </div>
              )}
            </div>
            {result.statName !== 'χ²' && (
              <Plot
                x={[-4.5, 4.5]}
                series={[
                  { type: 'fn', f: (x) => (result!.df ? D.tPdf(x, result!.df) : D.normPdf(x)), color: '#4F46E5', label: 'density' },
                  { type: 'vline', x: Math.max(-4.4, Math.min(4.4, result.statistic)), color: '#E11D48' },
                ]}
                height={220}
                interactive={false}
              />
            )}
          </>
        )}
        {ci.length > 0 &&
          ci.map((c) => (
            <div className="result-box" key={c.label}>
              <div className="result-label">
                {Math.round(v.level * 1000) / 10}% {c.label}
              </div>
              <Tex tex={`\\left(${fmt(c.lo, 8)},\\ ${fmt(c.hi, 8)}\\right)`} />
            </div>
          ))}
      </section>
    </div>
  );
}
