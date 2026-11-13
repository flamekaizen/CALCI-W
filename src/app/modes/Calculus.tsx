import { useMemo, useState } from 'react';
import { calculus, exactForm, numerics, expressionTex, createMath, prepare } from '../../core/index';

const texMath = createMath();
import { useStore } from '../store';
import { Tabs, Tex, NumberInput, Segmented, fmt, copyText } from '../ui';
import { Plot, type Series } from '../components/Plot';
import '../../styles/modes/tools.css';

type Tab = 'derivative' | 'integral' | 'limit' | 'taylor' | 'series';

function numTex(v: number): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? '\\text{undefined}' : v > 0 ? '\\infty' : '-\\infty';
  if (Number.isInteger(v)) return String(v);
  const e = exactForm(v);
  return e ? `${e.tex} \\approx ${Number(v.toPrecision(12))}` : String(Number(v.toPrecision(12)));
}

export default function Calculus() {
  const [tab, setTab] = useState<Tab>('derivative');
  const [expr, setExpr] = useState('x^2 sin(x)');
  const [v, setV] = useState('x');
  const variable = /^[A-Za-z_]\w*$/.test(v) ? v : 'x';

  const compiled = useMemo(() => {
    try {
      const f = calculus.fn1(expr, variable);
      f(0.5);
      return { f, error: null as string | null };
    } catch (e) {
      return { f: null, error: (e as Error).message.replace(/\s*\(char \d+\)$/, '') };
    }
  }, [expr, variable]);

  return (
    <div className="page">
      <section className="card card-pad stack-sm" style={{ marginBottom: 16 }}>
        <div className="row nowrap">
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="cf">Function f({variable})</label>
            <input id="cf" className="input mono" value={expr} onChange={(e) => setExpr(e.target.value)} placeholder="e.g. x^2 sin(x), e^(-x^2), ln(x)/x" spellCheck={false} />
          </div>
          <div className="field" style={{ width: 90 }}>
            <label htmlFor="cv">Variable</label>
            <input id="cv" className="input mono" value={v} onChange={(e) => setV(e.target.value)} />
          </div>
        </div>
        {compiled.error && <div className="error-text">{compiled.error}</div>}
        <div className="small muted">Calculus mode always uses radians.</div>
      </section>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'derivative', label: 'Derivative' },
          { id: 'integral', label: 'Integral' },
          { id: 'limit', label: 'Limit' },
          { id: 'taylor', label: 'Taylor series' },
          { id: 'series', label: 'Sum & product' },
        ]}
      />
      {compiled.f && tab === 'derivative' && <Derivative expr={expr} v={variable} f={compiled.f} />}
      {compiled.f && tab === 'integral' && <Integral expr={expr} v={variable} f={compiled.f} />}
      {compiled.f && tab === 'limit' && <Limit expr={expr} v={variable} f={compiled.f} />}
      {compiled.f && tab === 'taylor' && <Taylor expr={expr} v={variable} f={compiled.f} />}
      {tab === 'series' && <SeriesTab />}
    </div>
  );
}

interface P {
  expr: string;
  v: string;
  f: (x: number) => number;
}

function Derivative({ expr, v, f }: P) {
  const [order, setOrder] = useState(1);
  const [at, setAt] = useState(1);
  const sym = useMemo(() => {
    try {
      return { r: calculus.differentiate(expr, v, order), error: null };
    } catch (e) {
      return { r: null, error: (e as Error).message };
    }
  }, [expr, v, order]);
  const value = useMemo(() => calculus.derivativeAt(expr, at, v, order), [expr, at, v, order]);
  const df = useMemo(() => {
    if (sym.r) {
      try {
        const g = calculus.fn1(sym.r.text, v);
        g(0.3);
        return g;
      } catch {
        /* fall back */
      }
    }
    return (x: number) => numerics.derivative(f, x, order);
  }, [sym.r, v, f, order]);
  const slope = order === 1 ? value : calculus.derivativeAt(expr, at, v, 1);
  const y0 = f(at);
  const series: Series[] = [
    { type: 'fn', f, color: '#4F46E5', label: 'f' },
    { type: 'fn', f: df, color: '#E11D48', label: order === 1 ? "f'" : `f⁽${order}⁾`, dash: [7, 5] },
  ];
  if (Number.isFinite(y0) && Number.isFinite(slope)) {
    series.push({ type: 'fn', f: (x) => y0 + slope * (x - at), color: '#059669', width: 1.5, label: 'tangent' });
    series.push({ type: 'points', pts: [[at, y0]], color: '#059669', r: 5 });
  }
  const prime = order === 1 ? "'" : order === 2 ? "''" : `^{(${order})}`;
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="card card-pad stack">
        <div className="row">
          <span className="label">Order</span>
          <Segmented size="sm" value={order} onChange={setOrder} options={[1, 2, 3, 4, 5, 6].map((k) => ({ value: k, label: String(k) }))} />
        </div>
        <div className="result-box accent">
          <div className="result-label">Symbolic derivative</div>
          {sym.r ? <Tex tex={`f${prime}(${v}) = ${sym.r.tex}`} display /> : <span className="error-text">{sym.error}</span>}
        </div>
        {sym.r && (
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => copyText(sym.r!.text)}>
            Copy as text
          </button>
        )}
        <div className="field">
          <label>Evaluate at {v} =</label>
          <NumberInput value={at} onChange={setAt} />
        </div>
        <div className="stat-grid">
          <div className="stat">
            <div className="k">f({fmt(at)})</div>
            <div className="v">
              <Tex tex={numTex(y0)} />
            </div>
          </div>
          <div className="stat">
            <div className="k">
              f{order === 1 ? '′' : order === 2 ? '″' : `⁽${order}⁾`}({fmt(at)})
            </div>
            <div className="v">
              <Tex tex={numTex(value)} />
            </div>
          </div>
          {Number.isFinite(slope) && (
            <div className="stat" style={{ gridColumn: '1 / -1' }}>
              <div className="k">Tangent line at {v} = {fmt(at)}</div>
              <div className="v">
                y = {fmt(slope)}
                {v} {y0 - slope * at < 0 ? '−' : '+'} {fmt(Math.abs(y0 - slope * at))}
              </div>
            </div>
          )}
        </div>
      </section>
      <section className="card card-pad">
        <Plot x={[at - 6, at + 6]} series={series} height={360} />
      </section>
    </div>
  );
}

function Integral({ expr, v, f }: P) {
  const [a, setA] = useState(0);
  const [b, setB] = useState(Math.PI);
  const r = useMemo(() => {
    try {
      return calculus.definiteIntegral(expr, a, b, v);
    } catch {
      return null;
    }
  }, [expr, a, b, v]);
  const fa = Number.isFinite(a) ? a : -10;
  const fb = Number.isFinite(b) ? b : 10;
  const pad = Math.max(1, (fb - fa) * 0.25);
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="card card-pad stack">
        <div className="field-row">
          <div className="field">
            <label>Lower bound a</label>
            <NumberInput value={a} onChange={setA} placeholder="-Infinity allowed" />
          </div>
          <div className="field">
            <label>Upper bound b</label>
            <NumberInput value={b} onChange={setB} placeholder="Infinity allowed" />
          </div>
        </div>
        <div className="result-box accent">
          <div className="result-label">Definite integral</div>
          <Tex tex={`\\int_{${numTexShort(a)}}^{${numTexShort(b)}} f(${v})\\,d${v} = ${r ? numTex(r.value) : '\\text{—}'}`} display />
        </div>
        {r && (
          <div className="stat-grid">
            <div className="stat">
              <div className="k">Error estimate</div>
              <div className="v">± {r.error.toExponential(1)}</div>
            </div>
            <div className="stat">
              <div className="k">Evaluations</div>
              <div className="v">{r.evaluations.toLocaleString()}</div>
            </div>
            {Number.isFinite(a) && Number.isFinite(b) && b !== a && (
              <div className="stat">
                <div className="k">Average value</div>
                <div className="v">{fmt(r.value / (b - a))}</div>
              </div>
            )}
          </div>
        )}
        <p className="small muted">Computed with adaptive Gauss–Kronrod quadrature (15-point), which handles infinite bounds and most integrable singularities.</p>
      </section>
      <section className="card card-pad">
        <Plot
          x={[fa - pad, fb + pad]}
          series={[
            { type: 'area', f, a: fa, b: fb, color: '#4F46E5', opacity: 0.22 },
            { type: 'fn', f, color: '#4F46E5', label: 'f' },
          ]}
          height={360}
        />
      </section>
    </div>
  );
}

function numTexShort(v: number) {
  if (v === Infinity) return '\\infty';
  if (v === -Infinity) return '-\\infty';
  const e = exactForm(v);
  return e && e.kind === 'pi' ? e.tex : String(Number(v.toPrecision(6)));
}

function Limit({ expr, v, f }: P) {
  const [a, setA] = useState(0);
  const [side, setSide] = useState<'both' | 'left' | 'right'>('both');
  const r = useMemo(() => calculus.limitOf(expr, a, v, side), [expr, a, v, side]);
  const rows = useMemo(() => {
    if (!Number.isFinite(a)) return [10, 100, 1000, 1e4, 1e6].map((x) => ({ x: a > 0 ? x : -x, y: f(a > 0 ? x : -x) }));
    return [0.1, 0.01, 0.001, 0.0001, 1e-6].flatMap((h) => [
      ...(side !== 'right' ? [{ x: a - h, y: f(a - h) }] : []),
      ...(side !== 'left' ? [{ x: a + h, y: f(a + h) }] : []),
    ]);
  }, [a, f, side]);
  const sideTex = side === 'left' ? '^-' : side === 'right' ? '^+' : '';
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="card card-pad stack">
        <div className="field">
          <label>{v} approaches</label>
          <NumberInput value={a} onChange={setA} placeholder="number, Infinity or -Infinity" />
        </div>
        <Segmented
          size="sm"
          value={side}
          onChange={setSide}
          options={[
            { value: 'both', label: 'Two-sided' },
            { value: 'left', label: 'From the left' },
            { value: 'right', label: 'From the right' },
          ]}
        />
        <div className="result-box accent">
          <div className="result-label">Limit</div>
          <Tex tex={`\\lim_{${v} \\to ${numTexShort(a)}${sideTex}} f(${v}) = ${r.exists ? numTex(r.value) : '\\text{does not exist}'}`} display />
        </div>
        {side === 'both' && Number.isFinite(a) && (
          <div className="stat-grid">
            <div className="stat">
              <div className="k">Left-hand limit</div>
              <div className="v">{fmt(r.left)}</div>
            </div>
            <div className="stat">
              <div className="k">Right-hand limit</div>
              <div className="v">{fmt(r.right)}</div>
            </div>
          </div>
        )}
      </section>
      <section className="card card-pad stack-sm">
        <div className="section-title">Approaching values</div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{v}</th>
                <th>f({v})</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td className="num">{fmt(row.x, 10)}</td>
                  <td className="num">{fmt(row.y, 12)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Taylor({ expr, v, f }: P) {
  const [a, setA] = useState(0);
  const [n, setN] = useState(5);
  const r = useMemo(() => {
    try {
      return calculus.taylor(expr, v, a, n);
    } catch (e) {
      return { error: (e as Error).message } as any;
    }
  }, [expr, v, a, n]);
  const poly = (x: number) => (r.coefficients ? r.coefficients.reduce((s: number, c: number, k: number) => s + c * Math.pow(x - a, k), 0) : NaN);
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="card card-pad stack">
        <div className="field-row">
          <div className="field">
            <label>Centre a</label>
            <NumberInput value={a} onChange={setA} />
          </div>
          <div className="field">
            <label>Order n</label>
            <input type="range" min={1} max={12} value={n} onChange={(e) => setN(Number(e.target.value))} style={{ accentColor: 'var(--accent)' }} aria-label="Order" />
            <span className="badge num">n = {n}</span>
          </div>
        </div>
        <div className="result-box accent" style={{ overflowX: 'auto' }}>
          <div className="result-label">Taylor polynomial</div>
          {r.error ? <span className="error-text">{r.error}</span> : <Tex tex={`T_{${n}}(${v}) = ${r.tex}`} display />}
        </div>
        {r.text && (
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => copyText(r.text)}>
            Copy polynomial
          </button>
        )}
      </section>
      <section className="card card-pad">
        <Plot
          x={[a - 6, a + 6]}
          series={[
            { type: 'fn', f, color: '#4F46E5', label: 'f' },
            { type: 'fn', f: poly, color: '#D97706', label: `T${n}`, dash: [7, 5] },
          ]}
          height={360}
        />
      </section>
    </div>
  );
}

function SeriesTab() {
  const angle = useStore((s) => s.calc.angle);
  const [expr, setExpr] = useState('1/n^2');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(Infinity);
  const [kind, setKind] = useState<'sum' | 'product'>('sum');
  const r = useMemo(() => {
    try {
      const f = calculus.fn1(expr, 'n', angle);
      if (kind === 'sum') return { ...numerics.series(f, from, to), error: null };
      if (!Number.isFinite(to) && to !== Infinity) throw new Error('Invalid bound');
      return { value: numerics.product(f, from, to), converged: true, terms: 0, error: null };
    } catch (e) {
      return { value: NaN, converged: false, terms: 0, error: (e as Error).message };
    }
  }, [expr, from, to, kind, angle]);
  return (
    <section className="card card-pad stack" style={{ maxWidth: 720 }}>
      <Segmented
        size="sm"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'sum', label: 'Sum Σ' },
          { value: 'product', label: 'Product Π' },
        ]}
      />
      <div className="field">
        <label>Term a(n)</label>
        <input className="input mono" value={expr} onChange={(e) => setExpr(e.target.value)} placeholder="e.g. 1/n^2, (-1)^n/(2n+1), 1/n!" />
      </div>
      <div className="field-row">
        <div className="field">
          <label>n from</label>
          <NumberInput value={from} onChange={setFrom} />
        </div>
        <div className="field">
          <label>to</label>
          <NumberInput value={to} onChange={setTo} placeholder="Infinity allowed" />
        </div>
      </div>
      {r.error && <div className="error-text">{r.error}</div>}
      <div className="result-box accent">
        <Tex tex={`${kind === 'sum' ? '\\sum' : '\\prod'}_{n=${from}}^{${to === Infinity ? '\\infty' : to}} ${safeTex(expr)} = ${numTex(r.value)}`} display />
      </div>
      {kind === 'sum' && to === Infinity && (
        <div className="small muted">
          {r.converged ? `Converged after ${r.terms.toLocaleString()} terms.` : 'Did not converge within 5 million terms — the series may diverge or converge very slowly.'}
        </div>
      )}
    </section>
  );
}

function safeTex(expr: string): string {
  try {
    return expressionTex(texMath, texMath.parse(prepare(expr)));
  } catch {
    return '\\text{' + expr.replace(/[{}\\]/g, '') + '}';
  }
}
