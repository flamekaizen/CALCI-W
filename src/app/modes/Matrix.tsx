import { useEffect, useState } from 'react';
import { Minus, Plus, RotateCcw, Shuffle } from 'lucide-react';
import { getCalculator } from '../engine';
import { solver, toFraction, toNumber } from '../../core/index';
import { Tex, Segmented, parseNumber, toast } from '../ui';
import '../../styles/modes/tools.css';

type Name = 'A' | 'B' | 'C' | 'D';
type Cells = string[][];
const NAMES: Name[] = ['A', 'B', 'C', 'D'];
const STORE_KEY = 'calci-matrices-v1';

const make = (r: number, c: number, fill = '0'): Cells => Array.from({ length: r }, () => Array.from({ length: c }, () => fill));
const DEFAULTS: Record<Name, Cells> = {
  A: [['2', '1', '-1'], ['-3', '-1', '2'], ['-2', '1', '2']],
  B: [['8'], ['-11'], ['-3']],
  C: [['1', '2'], ['3', '4']],
  D: make(2, 2),
};

function load(): Record<Name, Cells> {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? '');
    if (v && NAMES.every((n) => Array.isArray(v[n]))) return v;
  } catch {
    /* ignore */
  }
  return DEFAULTS;
}

function numeric(cells: Cells): number[][] {
  return cells.map((r) => r.map((c) => parseNumber(c || '0')));
}

interface Out {
  title: string;
  tex: string;
  note?: string;
}

export default function MatrixMode() {
  const [mats, setMats] = useState<Record<Name, Cells>>(load);
  const [active, setActive] = useState<Name>('A');
  const [fractions, setFractions] = useState(true);
  const [expr, setExpr] = useState('inv(A) * B');
  const [out, setOut] = useState<Out[]>([]);
  const [error, setError] = useState<string | null>(null);
  const calc = getCalculator();
  const math = calc.math;

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(mats));
    } catch {
      /* ignore */
    }
  }, [mats]);

  const cells = mats[active];
  const rows = cells.length;
  const cols = cells[0]?.length ?? 1;

  const resize = (r: number, c: number) => {
    r = Math.max(1, Math.min(10, r));
    c = Math.max(1, Math.min(10, c));
    const next = make(r, c).map((row, i) => row.map((v, j) => cells[i]?.[j] ?? v));
    setMats({ ...mats, [active]: next });
  };

  const setCell = (i: number, j: number, v: string) => {
    const next = cells.map((r) => r.slice());
    next[i][j] = v;
    setMats({ ...mats, [active]: next });
  };

  const num = (v: number): string => {
    if (!Number.isFinite(v)) return Number.isNaN(v) ? '\\text{NaN}' : v > 0 ? '\\infty' : '-\\infty';
    const c = Math.abs(v) < 1e-12 ? 0 : v;
    if (fractions && !Number.isInteger(c)) {
      const f = toFraction(c, 1000, 1e-10);
      if (f) return `${f[0] < 0 ? '-' : ''}\\frac{${Math.abs(f[0])}}{${f[1]}}`;
    }
    return String(Number(c.toPrecision(8)));
  };
  const valueTex = (v: unknown): string => {
    if (typeof v === 'number') return num(v);
    const o = v as any;
    if (o?.isComplex) {
      const re = Math.abs(o.re) < 1e-12 ? 0 : o.re;
      const im = Math.abs(o.im) < 1e-12 ? 0 : o.im;
      if (im === 0) return num(re);
      return `${re !== 0 ? num(re) : ''}${im < 0 ? '-' : re !== 0 ? '+' : ''}${Math.abs(im) === 1 ? '' : num(Math.abs(im))}i`;
    }
    if (o?.isMatrix || Array.isArray(v)) {
      const arr = o?.isMatrix ? o.toArray() : (v as unknown[]);
      if (arr.length && Array.isArray(arr[0])) return `\\begin{bmatrix}${(arr as unknown[][]).map((r) => r.map(valueTex).join(' & ')).join(' \\\\ ')}\\end{bmatrix}`;
      return `\\begin{bmatrix}${arr.map(valueTex).join(' \\\\ ')}\\end{bmatrix}`;
    }
    if (o?.isBigNumber || o?.isFraction) return num(toNumber(v));
    return calc.format(v).tex;
  };

  const scope = () => {
    const sc = new Map<string, unknown>();
    for (const n of NAMES) sc.set(n, math.matrix(numeric(mats[n])));
    return sc;
  };

  const run = (title: string, fn: () => Out[] | Out) => {
    try {
      const r = fn();
      setOut(Array.isArray(r) ? r : [r]);
      setError(null);
    } catch (e) {
      setError((e as Error).message.replace(/\(.*?\)/g, '').trim());
      setOut([]);
    }
    void title;
  };

  const M = () => math.matrix(numeric(cells));
  const square = () => {
    if (rows !== cols) throw new Error(`${active} must be square (it is ${rows}×${cols})`);
  };

  const ops: { label: string; run: () => Out[] | Out }[] = [
    { label: 'Determinant', run: () => (square(), { title: `det(${active})`, tex: valueTex(math.det(M())) }) },
    { label: 'Inverse', run: () => (square(), { title: `${active}⁻¹`, tex: valueTex(math.inv(M())) }) },
    { label: 'Transpose', run: () => ({ title: `${active}ᵀ`, tex: valueTex(math.transpose(M())) }) },
    {
      label: 'RREF',
      run: () => {
        const [R, piv] = solver.rref(numeric(cells));
        return { title: `rref(${active})`, tex: valueTex(R), note: `Pivot columns: ${piv.map((p) => p + 1).join(', ') || 'none'}` };
      },
    },
    { label: 'Rank', run: () => ({ title: `rank(${active})`, tex: String(solver.rank(numeric(cells))) }) },
    { label: 'Trace', run: () => (square(), { title: `tr(${active})`, tex: valueTex(math.trace(M())) }) },
    {
      label: 'Eigen',
      run: () => {
        square();
        const r: any = math.eigs(M());
        const values = r.values;
        const vecs = r.eigenvectors as { value: unknown; vector: unknown }[] | undefined;
        const outs: Out[] = [{ title: `Eigenvalues of ${active}`, tex: valueTex(values) }];
        if (vecs?.length) outs.push({ title: 'Eigenvectors (columns, in order)', tex: `\\begin{bmatrix}${transposeArr(vecs.map((v) => toArr(v.vector))).map((row) => row.map(valueTex).join(' & ')).join(' \\\\ ')}\\end{bmatrix}` });
        return outs;
      },
    },
    {
      label: 'LU',
      run: () => {
        square();
        const r: any = math.lup(M());
        return [
          { title: 'L', tex: valueTex(r.L) },
          { title: 'U', tex: valueTex(r.U) },
          { title: 'Permutation', tex: valueTex(r.p.map((x: number) => x + 1)), note: 'P·A = L·U (row order shown 1-based)' },
        ];
      },
    },
    {
      label: 'QR',
      run: () => {
        const r: any = math.qr(M());
        return [
          { title: 'Q (orthogonal)', tex: valueTex(r.Q) },
          { title: 'R (upper triangular)', tex: valueTex(r.R) },
        ];
      },
    },
    { label: `${active}²`, run: () => (square(), { title: `${active}²`, tex: valueTex(math.pow(M(), 2)) }) },
    { label: 'Norm', run: () => ({ title: `‖${active}‖ (Frobenius)`, tex: valueTex(math.norm(M(), 'fro')) }) },
    {
      label: 'Solve A·x = B',
      run: () => {
        const A = numeric(mats.A);
        const b = numeric(mats.B).map((r) => r[0]);
        if (A.length !== b.length) throw new Error(`B needs ${A.length} rows to match A`);
        const s = solver.solveLinear(A, b);
        if (s.kind === 'unique') return { title: 'x', tex: valueTex(s.x), note: 'Unique solution (B is used as the right-hand side column)' };
        if (s.kind === 'none') return { title: 'No solution', tex: '\\text{The system is inconsistent}', note: 'RREF of [A | B] has a row 0 = nonzero' };
        return [
          { title: 'Infinitely many solutions', tex: `x = ${valueTex(s.particular)} + ${s.basis.map((v, i) => `t_{${i + 1}}${valueTex(v)}`).join(' + ')}` },
          { title: 'RREF of [A | B]', tex: valueTex(s.rref) },
        ];
      },
    },
  ];

  const evalExpr = () =>
    run('expr', () => {
      const v = math.evaluate(expr, scope());
      return { title: expr, tex: valueTex(v) };
    });

  return (
    <div className="page wide">
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="card">
          <div className="card-header">
            <div className="mat-tabs" role="tablist" aria-label="Matrices">
              {NAMES.map((n) => (
                <button key={n} className={`mat-tab${active === n ? ' active' : ''}`} onClick={() => setActive(n)} role="tab" aria-selected={active === n}>
                  {n}
                  <span className="small muted" style={{ marginLeft: 6, fontWeight: 500 }}>
                    {mats[n].length}×{mats[n][0].length}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="card-body stack">
            <div className="row">
              <span className="label">Rows</span>
              <button className="icon-btn sm" onClick={() => resize(rows - 1, cols)} aria-label="Remove row">
                <Minus size={14} />
              </button>
              <span className="badge num">{rows}</span>
              <button className="icon-btn sm" onClick={() => resize(rows + 1, cols)} aria-label="Add row">
                <Plus size={14} />
              </button>
              <span className="label" style={{ marginLeft: 12 }}>
                Columns
              </span>
              <button className="icon-btn sm" onClick={() => resize(rows, cols - 1)} aria-label="Remove column">
                <Minus size={14} />
              </button>
              <span className="badge num">{cols}</span>
              <button className="icon-btn sm" onClick={() => resize(rows, cols + 1)} aria-label="Add column">
                <Plus size={14} />
              </button>
              <div className="spacer" />
              <button className="btn btn-ghost btn-sm" onClick={() => setMats({ ...mats, [active]: make(rows, cols).map((r, i) => r.map((_, j) => (i === j ? '1' : '0'))) })} title="Identity">
                I
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setMats({ ...mats, [active]: make(rows, cols).map((r) => r.map(() => String(Math.floor(Math.random() * 19) - 9))) })}
                title="Random integers"
              >
                <Shuffle size={14} />
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setMats({ ...mats, [active]: make(rows, cols) })} title="Zero">
                <RotateCcw size={14} />
              </button>
            </div>
            <div className="matrix-editor">
              <div className="matrix-grid" style={{ gridTemplateColumns: `repeat(${cols}, auto)` }}>
                {cells.map((r, i) =>
                  r.map((v, j) => (
                    <input
                      key={`${i}-${j}`}
                      className={`cell-input${Number.isNaN(parseNumber(v || '0')) ? ' invalid' : ''}`}
                      value={v}
                      onChange={(e) => setCell(i, j, e.target.value)}
                      onFocus={(e) => e.target.select()}
                      aria-label={`${active} row ${i + 1} column ${j + 1}`}
                      inputMode="decimal"
                    />
                  )),
                )}
              </div>
              <span className="small muted">Cells accept expressions such as 1/3, sqrt(2) or 2pi.</span>
            </div>
            <div>
              <div className="section-title">Operations on {active}</div>
              <div className="op-grid">
                {ops.map((o) => (
                  <button key={o.label} className="btn btn-secondary btn-sm" onClick={() => run(o.label, o.run)}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="stack-sm">
              <div className="section-title" style={{ margin: 0 }}>
                Expression
              </div>
              <div className="row nowrap">
                <input className="input mono" value={expr} onChange={(e) => setExpr(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && evalExpr()} aria-label="Matrix expression" placeholder="e.g. A * B, inv(A) + 2C, A^3, det(A)" />
                <button className="btn btn-primary" onClick={evalExpr}>
                  Evaluate
                </button>
              </div>
              <span className="small muted">Use A, B, C, D with +, −, *, ^, inv(), det(), transpose(), dot(), cross(), kron()…</span>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h3>Result</h3>
            <div className="spacer" />
            <Segmented
              size="sm"
              value={fractions ? 'f' : 'd'}
              onChange={(v) => setFractions(v === 'f')}
              options={[
                { value: 'f', label: 'Fractions' },
                { value: 'd', label: 'Decimals' },
              ]}
            />
          </div>
          <div className="card-body stack">
            {error && <div className="error-text">{error}</div>}
            {!error && out.length === 0 && <div className="empty">Choose an operation or evaluate an expression.</div>}
            {out.map((o, i) => (
              <div key={i} className="stack-sm">
                <div className="row">
                  <strong>{o.title}</strong>
                  <div className="spacer" />
                  {o.tex.startsWith('\\begin{bmatrix}') && (
                    <span className="row nowrap small muted">
                      Store in
                      {NAMES.map((n) => (
                        <button key={n} className="btn btn-ghost btn-sm" onClick={() => saveTo(o, n, setMats, mats)}>
                          {n}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
                <div className="tex-result">
                  <Tex tex={o.tex} display />
                </div>
                {o.note && <div className="small muted">{o.note}</div>}
              </div>
            ))}
            <div className="stack-sm" style={{ marginTop: 8 }}>
              <div className="section-title" style={{ margin: 0 }}>
                {active}
              </div>
              <div className="tex-result">
                <Tex tex={valueTex(numeric(cells))} display />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function toArr(v: unknown): unknown[] {
  const o = v as any;
  return o?.isMatrix ? o.toArray() : (v as unknown[]);
}
function transposeArr(a: unknown[][]): unknown[][] {
  return a[0].map((_, j) => a.map((r) => r[j]));
}

function saveTo(o: Out, target: Name, set: (m: Record<Name, Cells>) => void, mats: Record<Name, Cells>) {
  const m = o.tex.match(/\\begin\{bmatrix\}(.*)\\end\{bmatrix\}/);
  if (!m) {
    toast('Only matrix results can be stored');
    return;
  }
  const rows = m[1].split('\\\\').map((r) =>
    r.split('&').map((c) => {
      const t = c.trim();
      const fr = t.match(/^(-?)\\frac\{(\d+)\}\{(\d+)\}$/);
      return fr ? `${fr[1]}${fr[2]}/${fr[3]}` : t.replace(/\\text\{.*\}/, '0');
    }),
  );
  set({ ...mats, [target]: rows });
  toast(`Stored in ${target}`);
}

