import { useMemo, useState } from 'react';
import { parse as mparse } from 'mathjs';
import { solver, exactForm, toFraction, normalizeInput } from '../../core/index';
import { compileNode, freeSymbols } from '../../core/compile';
import { useStore } from '../store';
import { Tabs, Tex, NumberInput, Segmented, fmt, copyText } from '../ui';
import { Plot } from '../components/Plot';
import { solveInequality } from '../../core/cas';
import '../../styles/modes/tools.css';

type Tab = 'poly' | 'linear' | 'equation' | 'inequality' | 'ratio';

export default function Solver() {
  const [tab, setTab] = useState<Tab>('poly');
  return (
    <div className="page">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'poly', label: 'Polynomial' },
          { id: 'linear', label: 'Linear system' },
          { id: 'equation', label: 'Any equation' },
          { id: 'inequality', label: 'Inequality' },
          { id: 'ratio', label: 'Ratio' },
        ]}
      />
      {tab === 'poly' && <Polynomial />}
      {tab === 'linear' && <Linear />}
      {tab === 'equation' && <Equation />}
      {tab === 'inequality' && <Inequality />}
      {tab === 'ratio' && <Ratio />}
    </div>
  );
}

const SUPS = ['', '', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹', '¹⁰'];

function numTex(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const e = exactForm(v);
  return e ? e.tex : String(Number(v.toPrecision(10)));
}

function Polynomial() {
  const [deg, setDeg] = useState(2);
  const [coef, setCoef] = useState<number[]>([1, -3, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
  const c = coef.slice(0, deg + 1);
  const valid = c.every(Number.isFinite) && c[0] !== 0;
  const roots = useMemo(() => (valid ? solver.polyRoots(c) : []), [valid, c.join(',')]);
  const f = (x: number) => c.reduce((s, a) => s * x + a, 0);
  const real = roots.filter((r) => r.im === 0).map((r) => r.re);
  const xr: [number, number] = real.length ? [Math.min(...real) - 2, Math.max(...real) + 2] : [-5, 5];
  if (xr[1] - xr[0] < 4) {
    xr[0] -= 2;
    xr[1] += 2;
  }
  const polyTex = c
    .map((a, i) => {
      const p = deg - i;
      if (a === 0) return '';
      const sign = a < 0 ? '-' : '+';
      const abs = Math.abs(a);
      const coefS = abs === 1 && p > 0 ? '' : numTex(abs);
      const xs = p === 0 ? '' : p === 1 ? 'x' : `x^{${p}}`;
      return `${sign} ${coefS}${xs}`;
    })
    .join(' ')
    .replace(/^\+ /, '')
    .replace(/^- /, '-');

  let extra: { k: string; v: string }[] = [];
  if (deg === 2 && valid) {
    const [a, b, cc] = c;
    const disc = b * b - 4 * a * cc;
    extra = [
      { k: 'Discriminant Δ = b² − 4ac', v: numTex(disc) },
      { k: 'Vertex', v: `\\left(${numTex(-b / (2 * a))},\\ ${numTex(cc - (b * b) / (4 * a))}\\right)` },
      { k: 'Nature of roots', v: disc > 0 ? '\\text{two real}' : disc === 0 ? '\\text{one repeated real}' : '\\text{two complex}' },
    ];
  }

  const rootTex = (r: { re: number; im: number }) => {
    if (r.im === 0) return numTex(r.re);
    const im = Math.abs(r.im);
    return `${r.re !== 0 ? numTex(r.re) : ''} ${r.im < 0 ? '-' : r.re !== 0 ? '+' : ''} ${im === 1 ? '' : numTex(im)}i`;
  };

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="card card-pad stack">
        <div className="row">
          <span className="label">Degree</span>
          <Segmented
            size="sm"
            value={deg}
            onChange={setDeg}
            options={[1, 2, 3, 4, 5, 6, 8, 10].map((d) => ({ value: d, label: String(d) }))}
          />
        </div>
        <div className="coef-row">
          {c.map((a, i) => {
            const p = deg - i;
            return (
              <span key={i} className="row nowrap" style={{ gap: 4 }}>
                {i > 0 && <span className="coef-term">+</span>}
                <NumberInput
                  value={a}
                  onChange={(v) => {
                    const n = coef.slice();
                    n[i] = v;
                    setCoef(n);
                  }}
                  ariaLabel={`Coefficient of x^${p}`}
                />
                <span className="coef-term">{p === 0 ? '' : p === 1 ? 'x' : `x${SUPS[p]}`}</span>
              </span>
            );
          })}
          <span className="coef-term">= 0</span>
        </div>
        {!valid && <div className="error-text">The leading coefficient must be a non-zero number.</div>}
        {valid && (
          <div className="result-box">
            <Tex tex={`${polyTex} = 0`} display />
          </div>
        )}
        {extra.length > 0 && (
          <div className="stat-grid">
            {extra.map((e) => (
              <div className="stat" key={e.k}>
                <div className="k">{e.k}</div>
                <div className="v">
                  <Tex tex={e.v} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="stack">
        <div className="card card-pad stack-sm">
          <div className="section-title">Roots</div>
          <div className="root-list">
            {roots.map((r, i) => (
              <button className="root-item" key={i} onClick={() => copyText(r.im ? `${r.re} ${r.im < 0 ? '-' : '+'} ${Math.abs(r.im)}i` : String(r.re))}>
                <span className="k">x{subscript(i + 1)}</span>
                <Tex tex={rootTex(r)} />
                {r.im === 0 && !Number.isInteger(r.re) && <span className="small muted num">≈ {fmt(r.re, 12)}</span>}
              </button>
            ))}
          </div>
        </div>
        {valid && (
          <div className="card card-pad">
            <Plot
              x={xr}
              series={[
                { type: 'fn', f, color: '#4F46E5', label: 'p(x)' },
                { type: 'points', pts: real.map((x) => [x, 0] as [number, number]), color: '#E11D48', r: 5 },
              ]}
              height={260}
            />
          </div>
        )}
      </section>
    </div>
  );
}

const VARS = ['x', 'y', 'z', 'w', 'v', 'u'];
function subscript(n: number) {
  return String(n).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)]);
}

function Linear() {
  const [n, setN] = useState(3);
  const [A, setA] = useState<number[][]>([
    [2, 1, -1, 0, 0, 0],
    [-3, -1, 2, 0, 0, 0],
    [-2, 1, 2, 0, 0, 0],
    [0, 0, 0, 1, 0, 0],
    [0, 0, 0, 0, 1, 0],
    [0, 0, 0, 0, 0, 1],
  ]);
  const [b, setB] = useState<number[]>([8, -11, -3, 0, 0, 0]);
  const AA = A.slice(0, n).map((r) => r.slice(0, n));
  const bb = b.slice(0, n);
  const valid = AA.flat().every(Number.isFinite) && bb.every(Number.isFinite);
  const sol = useMemo(() => (valid ? solver.solveLinear(AA, bb) : null), [valid, JSON.stringify(AA), bb.join(',')]);
  const frac = (v: number) => {
    if (Number.isInteger(v)) return String(v);
    const f = toFraction(v, 10000, 1e-10);
    return f ? `${f[0] < 0 ? '-' : ''}\\frac{${Math.abs(f[0])}}{${f[1]}}` : String(Number(v.toPrecision(10)));
  };
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="card card-pad stack">
        <div className="row">
          <span className="label">Unknowns</span>
          <Segmented size="sm" value={n} onChange={setN} options={[2, 3, 4, 5, 6].map((k) => ({ value: k, label: String(k) }))} />
        </div>
        <div className="sys-grid" style={{ gridTemplateColumns: `repeat(${n}, auto auto) auto auto` }}>
          {AA.map((row, i) => (
            <Row key={i}>
              {row.map((a, j) => (
                <span key={j} style={{ display: 'contents' }}>
                  <NumberInput
                    value={a}
                    onChange={(v) => {
                      const m = A.map((r) => r.slice());
                      m[i][j] = v;
                      setA(m);
                    }}
                    ariaLabel={`Equation ${i + 1} coefficient of ${VARS[j]}`}
                  />
                  <span className="sys-var">
                    {VARS[j]} {j < n - 1 ? '+' : ''}
                  </span>
                </span>
              ))}
              <span className="sys-var">=</span>
              <NumberInput
                value={bb[i]}
                onChange={(v) => {
                  const nb = b.slice();
                  nb[i] = v;
                  setB(nb);
                }}
                ariaLabel={`Equation ${i + 1} constant`}
              />
            </Row>
          ))}
        </div>
      </section>
      <section className="card card-pad stack">
        <div className="section-title">Solution</div>
        {!sol && <div className="error-text">Every coefficient must be a number.</div>}
        {sol?.kind === 'unique' && (
          <div className="root-list">
            {sol.x.map((v, i) => (
              <div className="root-item" key={i}>
                <span className="k">{VARS[i]}</span>
                <Tex tex={frac(v)} />
                {!Number.isInteger(v) && <span className="small muted num">≈ {fmt(v, 12)}</span>}
              </div>
            ))}
          </div>
        )}
        {sol?.kind === 'none' && <div className="result-box">No solution — the equations are inconsistent.</div>}
        {sol?.kind === 'infinite' && (
          <div className="stack-sm">
            <div className="result-box">Infinitely many solutions ({sol.free.length} free {sol.free.length === 1 ? 'variable' : 'variables'}).</div>
            <Tex
              display
              tex={`\\begin{pmatrix}${VARS.slice(0, n).join('\\\\')}\\end{pmatrix} = \\begin{pmatrix}${sol.particular.map(frac).join('\\\\')}\\end{pmatrix} ${sol.basis
                .map((v, k) => `+ t_{${k + 1}}\\begin{pmatrix}${v.map(frac).join('\\\\')}\\end{pmatrix}`)
                .join(' ')}`}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Equation() {
  const angle = useStore((s) => s.calc.angle);
  const [text, setText] = useState('cos(x) = x');
  const [range, setRange] = useState<[number, number]>([-10, 10]);
  const parsed = useMemo(() => {
    try {
      const norm = normalizeInput(text);
      const parts = norm.split(/(?<![<>!=])=(?!=)/);
      if (parts.length > 2) throw new Error('Use a single = sign');
      const lhs = mparse(parts[0]);
      const rhs = mparse(parts[1] ?? '0');
      const syms = new Set([...freeSymbols(lhs), ...freeSymbols(rhs)].filter((s) => !['pi', 'e', 'tau', 'phi', 'Infinity'].includes(s)));
      if (syms.size > 1) throw new Error(`Only one unknown is supported (found ${[...syms].join(', ')})`);
      const v = [...syms][0] ?? 'x';
      const L = compileNode(lhs, { vars: [v], angle });
      const R = compileNode(rhs, { vars: [v], angle });
      return { v, L, R, error: null as string | null };
    } catch (e) {
      return { v: 'x', L: null, R: null, error: (e as Error).message.replace(/\s*\(char \d+\)$/, '') };
    }
  }, [text, angle]);
  const roots = useMemo(() => {
    if (!parsed.L || !parsed.R || !(range[1] > range[0])) return [];
    const g = (x: number) => parsed.L!(x) - parsed.R!(x);
    return solver.solveEquation(g, range[0], range[1]);
  }, [parsed, range]);
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="card card-pad stack">
        <div className="field">
          <label htmlFor="eq">Equation</label>
          <input id="eq" className="input mono" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. x^3 - 2x = 5, e^x = 3 - x, sin(x) = 0.3" />
          <div className="hint">Finds every real solution in the search range. Trig uses the current angle unit ({angle}).</div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Search from</label>
            <NumberInput value={range[0]} onChange={(v) => setRange([v, range[1]])} />
          </div>
          <div className="field">
            <label>to</label>
            <NumberInput value={range[1]} onChange={(v) => setRange([range[0], v])} />
          </div>
        </div>
        {parsed.error && <div className="error-text">{parsed.error}</div>}
        <div className="section-title">Solutions</div>
        {roots.length === 0 && !parsed.error && <div className="muted">No real solutions in this range.</div>}
        <div className="root-list">
          {roots.map((r, i) => (
            <button className="root-item" key={i} onClick={() => copyText(String(r))}>
              <span className="k">
                {parsed.v}
                {subscript(i + 1)}
              </span>
              <Tex tex={numTex(r)} />
              {!Number.isInteger(r) && <span className="small muted num">≈ {fmt(r, 12)}</span>}
            </button>
          ))}
        </div>
      </section>
      {parsed.L && parsed.R && (
        <section className="card card-pad">
          <Plot
            x={range}
            series={[
              { type: 'fn', f: parsed.L, color: '#4F46E5', label: 'left' },
              { type: 'fn', f: parsed.R, color: '#E11D48', label: 'right' },
              { type: 'points', pts: roots.map((r) => [r, parsed.L!(r)] as [number, number]), color: '#059669', r: 5 },
            ]}
            height={320}
          />
        </section>
      )}
    </div>
  );
}

function Inequality() {
  const [text, setText] = useState('x^2 - 3x + 2 > 0');
  const r = useMemo(() => {
    try {
      return { res: solveInequality(text), error: null as string | null };
    } catch (e) {
      return { res: null, error: (e as Error).message };
    }
  }, [text]);
  const parts = text.split(/<=|>=|≤|≥|<|>/);
  const f = useMemo(() => {
    try {
      const L = compileNode(mparse(normalizeInput(parts[0] ?? '0')), { vars: ['x'] });
      const R = compileNode(mparse(normalizeInput(parts[parts.length - 1] ?? '0')), { vars: ['x'] });
      return (x: number) => L(x) - R(x);
    } catch {
      return null;
    }
  }, [text]);
  const ends = (r.res?.intervals ?? []).flatMap(([a, b]) => [a, b]).filter(Number.isFinite);
  const lo = ends.length ? Math.min(...ends) - 3 : -5;
  const hi = ends.length ? Math.max(...ends) + 3 : 5;
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="card card-pad stack">
        <div className="field">
          <label htmlFor="ineq">Inequality in x</label>
          <input id="ineq" className="input mono" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. x^2 - 4 <= 0, (x-1)/(x+2) > 0, 1 < x^2 < 4" />
          <div className="hint">Polynomial and rational inequalities with &lt;, &gt;, ≤ (&lt;=), ≥ (&gt;=), or a chain like 1 &lt; x^2 &lt; 4.</div>
        </div>
        {r.error && <div className="error-text">{r.error}</div>}
        {r.res && (
          <div className="result-box accent">
            <div className="result-label">Solution</div>
            <Tex tex={r.res.tex} display />
            <div className="small muted" style={{ marginTop: 6 }}>
              {r.res.all ? 'True for every real x.' : r.res.none ? 'No real x satisfies it.' : r.res.text}
            </div>
          </div>
        )}
      </section>
      {f && (
        <section className="card card-pad">
          <div className="small muted" style={{ marginBottom: 6 }}>
            Left side minus right side — the solution is where the curve is above (for &gt;) or below (for &lt;) zero.
          </div>
          <Plot
            x={[lo, hi]}
            series={[
              ...(r.res?.intervals ?? []).map(([a, b]) => ({ type: 'area' as const, f: () => 1e9, a: Math.max(a, lo - 10), b: Math.min(b, hi + 10), color: '#059669', opacity: 0.12 })),
              { type: 'fn', f, color: '#4F46E5', label: 'L − R' },
              { type: 'hline', y: 0, color: '#94A3B8' },
            ]}
            height={300}
          />
        </section>
      )}
    </div>
  );
}

function Ratio() {
  // A : B = C : D — leave exactly one box empty
  const [vals, setVals] = useState<number[]>([3, 4, NaN, 20]);
  const empty = vals.map((v, i) => (Number.isFinite(v) ? -1 : i)).filter((i) => i >= 0);
  let answer: number | null = null;
  let err: string | null = null;
  if (empty.length !== 1) err = 'Leave exactly one box empty to solve for it.';
  else {
    const [A, B, C, D] = vals;
    const k = empty[0];
    answer = k === 0 ? (B * C) / D : k === 1 ? (A * D) / C : k === 2 ? (A * D) / B : (B * C) / A;
    if (!Number.isFinite(answer)) err = 'That ratio has no solution (division by zero).';
  }
  const names = ['A', 'B', 'C', 'D'];
  return (
    <section className="card card-pad stack" style={{ maxWidth: 640 }}>
      <p className="small muted">Solve a proportion A : B = C : D. Leave the unknown box empty.</p>
      <div className="row nowrap ratio-row">
        {[0, 1].map((i) => (
          <NumberInput key={i} value={vals[i]} allowEmpty placeholder={names[i]} ariaLabel={names[i]} onChange={(v) => setVals(vals.map((x, j) => (j === i ? v : x)))} />
        ))}
        <span className="coef-term">=</span>
        {[2, 3].map((i) => (
          <NumberInput key={i} value={vals[i]} allowEmpty placeholder={names[i]} ariaLabel={names[i]} onChange={(v) => setVals(vals.map((x, j) => (j === i ? v : x)))} />
        ))}
      </div>
      <div className="small muted ratio-hint">A : B = C : D</div>
      {err ? (
        <div className="error-text">{err}</div>
      ) : (
        <div className="result-box accent">
          <div className="result-label">{names[empty[0]]} =</div>
          <Tex tex={numTex(answer!)} display />
        </div>
      )}
    </section>
  );
}
