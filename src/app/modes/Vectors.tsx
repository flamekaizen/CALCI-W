import { useMemo, useState } from 'react';
import { NumberInput, Segmented, Tex } from '../ui';
import { exactForm } from '../../core/index';
import { useStore } from '../store';

type Vec = number[];
const dot = (a: Vec, b: Vec) => a.reduce((s, v, i) => s + v * b[i], 0);
const mag = (a: Vec) => Math.sqrt(dot(a, a));
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function nt(v: number): string {
  if (!Number.isFinite(v)) return '\\text{undefined}';
  const c = Math.abs(v) < 1e-12 ? 0 : v;
  if (Number.isInteger(c)) return String(c);
  const e = exactForm(c);
  return e ? e.tex : String(Number(c.toPrecision(10)));
}
const vt = (a: Vec) => `\\begin{pmatrix}${a.map(nt).join('\\\\')}\\end{pmatrix}`;

/** Vector calculations for 2D / 3D vectors (dot, cross, angle, projection, …). */
export default function Vectors() {
  const angleUnit = useStore((s) => s.calc.angle);
  const [dim, setDim] = useState<2 | 3>(3);
  const [vecs, setVecs] = useState<Record<'A' | 'B' | 'C', Vec>>({ A: [1, 2, 2], B: [3, 0, 4], C: [0, 1, 0] });
  const A = vecs.A.slice(0, dim);
  const B = vecs.B.slice(0, dim);
  const C = vecs.C.slice(0, dim);
  const toUnit = (rad: number) => (angleUnit === 'deg' ? (rad * 180) / Math.PI : angleUnit === 'grad' ? (rad * 200) / Math.PI : rad);
  const unitLabel = angleUnit === 'deg' ? '°' : angleUnit === 'grad' ? ' grad' : ' rad';

  const rows = useMemo(() => {
    const out: { k: string; tex: string; note?: string }[] = [];
    const mA = mag(A);
    const mB = mag(B);
    out.push({ k: '|A|', tex: nt(mA) }, { k: '|B|', tex: nt(mB) });
    out.push({ k: 'A + B', tex: vt(A.map((v, i) => v + B[i])) }, { k: 'A − B', tex: vt(A.map((v, i) => v - B[i])) });
    out.push({ k: 'A · B (dot product)', tex: nt(dot(A, B)) });
    if (dim === 3) out.push({ k: 'A × B (cross product)', tex: vt(cross(A, B)) });
    else out.push({ k: 'A × B (z-component)', tex: nt(A[0] * B[1] - A[1] * B[0]) });
    const cosT = dot(A, B) / (mA * mB);
    out.push({ k: 'Angle between A and B', tex: `${Number(toUnit(Math.acos(Math.max(-1, Math.min(1, cosT)))).toPrecision(10))}${unitLabel === '°' ? '^{\\circ}' : `\\text{${unitLabel}}`}` });
    out.push({ k: 'Unit vector of A', tex: vt(A.map((v) => v / mA)) });
    out.push({ k: 'Projection of A onto B', tex: vt(B.map((v) => (v * dot(A, B)) / dot(B, B))) });
    out.push({ k: 'Distance from A to B', tex: nt(mag(A.map((v, i) => v - B[i]))) });
    if (dim === 3) {
      const triple = dot(A, cross(B, C));
      out.push({ k: 'A · (B × C) (scalar triple product)', tex: nt(triple), note: 'Volume of the parallelepiped spanned by A, B, C' });
      out.push({ k: 'Area of triangle A, B (from origin)', tex: nt(mag(cross(A, B)) / 2) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify([A, B, C]), dim, angleUnit]);

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="card card-pad stack">
        <Segmented
          size="sm"
          value={dim}
          onChange={setDim}
          options={[
            { value: 2, label: '2D' },
            { value: 3, label: '3D' },
          ]}
        />
        {(['A', 'B', 'C'] as const).filter((n) => n !== 'C' || dim === 3).map((n) => (
          <div className="row nowrap vec-row" key={n}>
            <strong style={{ width: 22 }}>{n}</strong>
            {Array.from({ length: dim }, (_, i) => (
              <NumberInput
                key={i}
                value={vecs[n][i]}
                ariaLabel={`${n} component ${i + 1}`}
                onChange={(v) => setVecs({ ...vecs, [n]: vecs[n].map((x, j) => (j === i ? v : x)) })}
              />
            ))}
          </div>
        ))}
        <p className="small muted">Components accept expressions like sqrt(2) or 1/3. Angles use your angle unit ({angleUnit}).</p>
      </section>
      <section className="card card-pad stack-sm">
        {rows.map((r) => (
          <div className="stat" key={r.k} title={r.note}>
            <div className="k">{r.k}</div>
            <div className="v" style={{ overflowX: 'auto' }}>
              <Tex tex={r.tex} />
            </div>
          </div>
        ))}
        <p className="small muted">Results show exact forms (fractions, √) when they are simple.</p>
      </section>
    </div>
  );
}
