import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X, Eye, EyeOff, RotateCw, Home } from 'lucide-react';
import { parse as mparse } from 'mathjs';
import { compileNode, type NumFn } from '../../core/compile';
import { compileGraph } from '../../core/graph/parse';
import { colormap, adaptColor, CURVE_COLORS_LIGHT } from '../../core/graph/palette';
import { normalizeInput, splitTopLevel } from '../../core/normalize';
import { useStore, uid } from '../store';
import { libraryLines } from '../engine';
import { cssVar, useResolvedTheme, useMediaQuery } from '../ui';
import '../../styles/modes/graph.css';

type Compiled =
  | { kind: 'surface'; f: NumFn; color: string }
  | { kind: 'curve'; fx: NumFn; fy: NumFn; fz: NumFn; color: string }
  | { kind: 'error'; error: string }
  | { kind: 'empty' };

function compile3d(text: string, color: string, ctx: { constants: Record<string, number>; functions: Record<string, NumFn> }): Compiled {
  const t = text.trim();
  if (!t) return { kind: 'empty' };
  try {
    let s = normalizeInput(t);
    if (s.startsWith('(') && s.endsWith(')')) {
      const parts = splitTopLevel(s.slice(1, -1), ',');
      if (parts.length === 3) {
        const [fx, fy, fz] = parts.map((p) => compileNode(mparse(p), { vars: ['t'], ...ctx }));
        return { kind: 'curve', fx, fy, fz, color };
      }
    }
    s = s.replace(/^\s*(z|f\s*\(\s*x\s*,\s*y\s*\))\s*=/, '');
    return { kind: 'surface', f: compileNode(mparse(s), { vars: ['x', 'y'], ...ctx }), color };
  } catch (e) {
    return { kind: 'error', error: (e as Error).message.replace(/\s*\(char \d+\)$/, '') };
  }
}

export default function Graph3D() {
  const g3 = useStore((s) => s.graph3d);
  const set3d = useStore((s) => s.set3d);
  const library = useStore((s) => s.library);
  const theme = useResolvedTheme();
  const narrow = useMediaQuery('(max-width: 860px)');
  const ctx = useMemo(() => {
    const g = compileGraph([], { library: libraryLines() });
    return { constants: g.constants, functions: g.functions };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library]);
  const compiled = useMemo(() => g3.surfaces.map((s) => (s.hidden ? { kind: 'empty' as const } : compile3d(s.text, s.color, ctx))), [g3.surfaces, ctx]);
  const [rot, setRot] = useState({ yaw: -0.8, pitch: 0.55, zoom: 1 });
  const [auto, setAuto] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!auto) return;
    let raf = 0;
    const loop = () => {
      setRot((r) => ({ ...r, yaw: r.yaw + 0.006 }));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [auto]);

  // sample surfaces (independent of rotation)
  const meshes = useMemo(() => {
    const R = g3.range;
    const N = Math.max(8, Math.min(120, g3.resolution));
    const out: { color: string; z: Float64Array; zmin: number; zmax: number }[] = [];
    for (const c of compiled) {
      if (c.kind !== 'surface') continue;
      const z = new Float64Array((N + 1) * (N + 1));
      const vals: number[] = [];
      for (let j = 0; j <= N; j++)
        for (let i = 0; i <= N; i++) {
          const v = c.f(-R + (2 * R * i) / N, -R + (2 * R * j) / N);
          z[j * (N + 1) + i] = v;
          if (Number.isFinite(v)) vals.push(v);
        }
      vals.sort((a, b) => a - b);
      const zmin = vals.length ? vals[Math.floor(vals.length * 0.01)] : -1;
      const zmax = vals.length ? vals[Math.ceil(vals.length * 0.99) - 1] : 1;
      out.push({ color: c.color, z, zmin, zmax });
    }
    return { N, R, out };
  }, [compiled, g3.range, g3.resolution]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !size.w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = size.w;
    const H = size.h;
    g.fillStyle = cssVar('--graph-bg');
    g.fillRect(0, 0, W, H);
    const dark = theme === 'dark';
    const { N, R, out } = meshes;
    let zlo = Math.min(...out.map((m) => m.zmin), -1e-9);
    let zhi = Math.max(...out.map((m) => m.zmax), 1e-9);
    if (!out.length) {
      zlo = -R;
      zhi = R;
    }
    if (zhi - zlo < 1e-9) {
      zhi += 1;
      zlo -= 1;
    }
    const zmid = (zlo + zhi) / 2;
    const zs = 2 / (zhi - zlo);
    const cy = Math.cos(rot.yaw);
    const sy = Math.sin(rot.yaw);
    const cp = Math.cos(rot.pitch);
    const sp = Math.sin(rot.pitch);
    const scale = Math.min(W, H) * 0.32 * rot.zoom;
    const camD = 5;
    // model coords: X, Y in [-1,1], Z in [-1,1]
    const project = (X: number, Y: number, Z: number): [number, number, number] => {
      const x1 = X * cy - Y * sy;
      const y1 = X * sy + Y * cy;
      // pitch: rotate around x-axis so z points up on screen
      const y2 = y1 * cp - Z * sp;
      const z2 = y1 * sp + Z * cp;
      const persp = camD / (camD - y2 * -1 + 0.0001);
      return [W / 2 + x1 * scale * persp, H / 2 - z2 * scale * persp, y2];
    };
    const axisC = cssVar('--graph-axis');
    const minorC = cssVar('--graph-major');
    const textC = cssVar('--graph-text');
    // floor grid
    g.strokeStyle = minorC;
    g.lineWidth = 1;
    g.beginPath();
    for (let k = -4; k <= 4; k++) {
      const v = k / 4;
      let p = project(v, -1, -1);
      g.moveTo(p[0], p[1]);
      p = project(v, 1, -1);
      g.lineTo(p[0], p[1]);
      p = project(-1, v, -1);
      g.moveTo(p[0], p[1]);
      p = project(1, v, -1);
      g.lineTo(p[0], p[1]);
    }
    g.stroke();
    // surfaces: collect quads, sort far-to-near
    type Quad = { pts: [number, number][]; depth: number; fill: string };
    const quads: Quad[] = [];
    const light = [0.4, -0.5, 0.75];
    const ln = Math.hypot(...light);
    for (const m of out) {
      const base = hexToRgb(adaptColor(m.color, dark));
      const P: ([number, number, number] | null)[] = new Array((N + 1) * (N + 1));
      const M: ([number, number, number] | null)[] = new Array((N + 1) * (N + 1));
      for (let j = 0; j <= N; j++)
        for (let i = 0; i <= N; i++) {
          const k = j * (N + 1) + i;
          const z = m.z[k];
          if (!Number.isFinite(z) || z < zlo - (zhi - zlo) * 0.5 || z > zhi + (zhi - zlo) * 0.5) {
            P[k] = null;
            M[k] = null;
            continue;
          }
          const X = -1 + (2 * i) / N;
          const Y = -1 + (2 * j) / N;
          const Z = Math.max(-1.5, Math.min(1.5, (z - zmid) * zs));
          M[k] = [X, Y, Z];
          P[k] = project(X, Y, Z);
        }
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const k = j * (N + 1) + i;
          const a = P[k];
          const b = P[k + 1];
          const c2 = P[k + N + 2];
          const d = P[k + N + 1];
          if (!a || !b || !c2 || !d) continue;
          const ma = M[k]!;
          const mb = M[k + 1]!;
          const md = M[k + N + 1]!;
          // normal in model space
          const ux = mb[0] - ma[0], uy = mb[1] - ma[1], uz = mb[2] - ma[2];
          const vx = md[0] - ma[0], vy = md[1] - ma[1], vz = md[2] - ma[2];
          let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          const nl = Math.hypot(nx, ny, nz) || 1;
          nx /= nl;
          ny /= nl;
          nz /= nl;
          const shade = 0.55 + 0.45 * Math.abs((nx * light[0] + ny * light[1] + nz * light[2]) / ln);
          const zAvg = (ma[2] + mb[2] + md[2] + M[k + N + 2]![2]) / 4;
          let rgb: [number, number, number];
          if (out.length === 1) rgb = colormap((zAvg + 1) / 2);
          else rgb = base;
          const fill = `rgb(${Math.round(rgb[0] * shade)},${Math.round(rgb[1] * shade)},${Math.round(rgb[2] * shade)})`;
          quads.push({ pts: [[a[0], a[1]], [b[0], b[1]], [c2[0], c2[1]], [d[0], d[1]]], depth: (a[2] + b[2] + c2[2] + d[2]) / 4, fill });
        }
    }
    quads.sort((p, q) => q.depth - p.depth);
    g.lineJoin = 'round';
    for (const q of quads) {
      g.beginPath();
      g.moveTo(q.pts[0][0], q.pts[0][1]);
      for (let i = 1; i < 4; i++) g.lineTo(q.pts[i][0], q.pts[i][1]);
      g.closePath();
      g.fillStyle = q.fill;
      g.fill();
      if (g3.wireframe) {
        g.strokeStyle = dark ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.35)';
        g.lineWidth = 0.6;
        g.stroke();
      } else {
        g.strokeStyle = q.fill;
        g.lineWidth = 0.6;
        g.stroke();
      }
    }
    // parametric curves (drawn on top)
    for (const c of compiled) {
      if (c.kind !== 'curve') continue;
      g.strokeStyle = adaptColor(c.color, dark);
      g.lineWidth = 2.5;
      g.beginPath();
      let started = false;
      for (let i = 0; i <= 800; i++) {
        const t = (i / 800) * 4 * Math.PI;
        const x = c.fx(t) / R;
        const y = c.fy(t) / R;
        const z = (c.fz(t) - zmid) * zs;
        if (![x, y, z].every(Number.isFinite)) {
          started = false;
          continue;
        }
        const p = project(x, y, z);
        if (!started) g.moveTo(p[0], p[1]);
        else g.lineTo(p[0], p[1]);
        started = true;
      }
      g.stroke();
    }
    // box edges + axis labels
    g.strokeStyle = axisC;
    g.globalAlpha = 0.6;
    g.lineWidth = 1;
    const edges: [number, number, number][][] = [
      [[-1, -1, -1], [1, -1, -1]], [[-1, -1, -1], [-1, 1, -1]], [[-1, -1, -1], [-1, -1, 1]],
    ];
    g.beginPath();
    for (const [p0, p1] of edges) {
      const a = project(...p0);
      const b = project(...p1);
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
    }
    g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = textC;
    g.font = `600 13px ${cssVar('--font-ui')}`;
    const lbl = (t: string, p: [number, number, number]) => {
      const q = project(...p);
      g.fillText(t, q[0], q[1]);
    };
    lbl('x', [1.15, -1, -1]);
    lbl('y', [-1, 1.15, -1]);
    lbl('z', [-1, -1, 1.15]);
    g.font = `11px ${cssVar('--font-ui')}`;
    lbl(`${fmtShort(R)}`, [1, -1.12, -1]);
    lbl(`${fmtShort(-R)}`, [-1, -1.12, -1]);
    lbl(`${fmtShort(zhi)}`, [-1.1, -1, 1]);
    lbl(`${fmtShort(zlo)}`, [-1.1, -1, -1]);
  }, [meshes, rot, size, theme, g3.wireframe, compiled]);

  // interaction
  const drag = useRef<{ x: number; y: number; r: typeof rot } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; zoom: number } | null>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setRot((r) => ({ ...r, zoom: Math.max(0.3, Math.min(4, r.zoom * Math.exp(-e.deltaY * 0.0012))) }));
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, []);

  const updateSurface = (id: string, patch: Partial<{ text: string; hidden: boolean }>) => set3d({ surfaces: g3.surfaces.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

  return (
    <div className={`graph-mode${narrow ? ' narrow' : ''}`}>
      <aside className="expr-panel">
        <div className="expr-toolbar">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => set3d({ surfaces: [...g3.surfaces, { id: uid(), text: '', color: CURVE_COLORS_LIGHT[g3.surfaces.length % 8] }] })}
          >
            <Plus size={15} /> Surface
          </button>
        </div>
        <div className="expr-list">
          {g3.surfaces.map((s, i) => {
            const c = compiled[i];
            return (
              <div className={`expr-row${c.kind === 'error' ? ' has-error' : ''}`} key={s.id}>
                <div className="expr-index">{i + 1}</div>
                <div className="expr-side">
                  <button
                    className={`expr-swatch${s.hidden ? ' off' : ''}`}
                    style={{ '--c': adaptColor(s.color, theme === 'dark') } as React.CSSProperties}
                    onClick={() => updateSurface(s.id, { hidden: !s.hidden })}
                    aria-label={s.hidden ? 'Show' : 'Hide'}
                  >
                    {s.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </div>
                <div className="expr-body">
                  <input className="expr-input" value={s.text} onChange={(e) => updateSurface(s.id, { text: e.target.value })} placeholder="z = sin(x) cos(y)" spellCheck={false} aria-label={`Surface ${i + 1}`} />
                  {c.kind === 'error' && <div className="expr-error">{c.error}</div>}
                  {c.kind === 'curve' && <div className="expr-kind">3D curve, t from 0 to 4π</div>}
                </div>
                <div className="expr-actions" style={{ opacity: 1 }}>
                  <button className="icon-btn sm" onClick={() => set3d({ surfaces: g3.surfaces.filter((x) => x.id !== s.id) })} aria-label="Delete">
                    <X size={15} />
                  </button>
                </div>
              </div>
            );
          })}
          <div className="card-body stack-sm">
            <label className="field">
              <span className="label">
                Domain: −{g3.range} ≤ x, y ≤ {g3.range}
              </span>
              <input type="range" min={1} max={20} step={0.5} value={g3.range} onChange={(e) => set3d({ range: Number(e.target.value) })} style={{ accentColor: 'var(--accent)' }} />
            </label>
            <label className="field">
              <span className="label">Resolution: {g3.resolution} × {g3.resolution}</span>
              <input type="range" min={12} max={100} step={2} value={g3.resolution} onChange={(e) => set3d({ resolution: Number(e.target.value) })} style={{ accentColor: 'var(--accent)' }} />
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={g3.wireframe} onChange={(e) => set3d({ wireframe: e.target.checked })} />
              Show mesh lines
            </label>
            <p className="small muted">
              Enter <code>z = f(x, y)</code> for surfaces or <code>(cos t, sin t, t/4)</code> for space curves. Drag to rotate, scroll or pinch to zoom.
            </p>
          </div>
        </div>
      </aside>
      <section className="graph-area" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="graph-canvas"
          style={{ position: 'absolute', inset: 0, cursor: 'grab' }}
          role="img"
          aria-label="3D surface plot"
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture(e.pointerId);
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pointers.current.size === 2) {
              const [a, b] = [...pointers.current.values()];
              pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: rot.zoom };
              drag.current = null;
            } else drag.current = { x: e.clientX, y: e.clientY, r: rot };
          }}
          onPointerMove={(e) => {
            if (!pointers.current.has(e.pointerId)) return;
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pinch.current && pointers.current.size === 2) {
              const [a, b] = [...pointers.current.values()];
              const d = Math.hypot(a.x - b.x, a.y - b.y);
              setRot((r) => ({ ...r, zoom: Math.max(0.3, Math.min(4, (pinch.current!.zoom * d) / pinch.current!.d)) }));
              return;
            }
            const d = drag.current;
            if (!d) return;
            setRot({ ...d.r, yaw: d.r.yaw - (e.clientX - d.x) * 0.008, pitch: Math.max(0.05, Math.min(Math.PI - 0.05, d.r.pitch - (e.clientY - d.y) * 0.008)) });
          }}
          onPointerUp={(e) => {
            pointers.current.delete(e.pointerId);
            drag.current = null;
            if (pointers.current.size < 2) pinch.current = null;
          }}
        />
        <div className="graph-tools">
          <button className={`icon-btn${auto ? ' active' : ''}`} onClick={() => setAuto((a) => !a)} aria-label="Auto-rotate" title="Auto-rotate">
            <RotateCw size={18} />
          </button>
          <button className="icon-btn" onClick={() => setRot({ yaw: -0.8, pitch: 0.55, zoom: 1 })} aria-label="Reset view" title="Reset view">
            <Home size={18} />
          </button>
        </div>
      </section>
    </div>
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function fmtShort(v: number) {
  return String(Number(v.toPrecision(3)));
}
