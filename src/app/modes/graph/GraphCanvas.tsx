import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CompiledItem } from '../../../core/graph/parse';
import { sampleItem, inequalityRegion, type Viewport, type Polyline } from '../../../core/graph/sample';
import { pointsOfInterest, type Poi } from '../../../core/graph/analysis';
import { niceStep, ticks, tickLabel, minorDivisions, piStep } from '../../../core/graph/ticks';
import { adaptColor } from '../../../core/graph/palette';
import type { GraphSettings, GraphView } from '../../store';
import { cssVar, useResolvedTheme } from '../../ui';

export interface StyledItem {
  item: CompiledItem;
  color: string;
  hidden?: boolean;
  style?: 'solid' | 'dashed' | 'dotted';
  width?: number;
  fillOpacity?: number;
}

export interface GraphCanvasHandle {
  zoom: (factor: number) => void;
  toPNG: () => Promise<Blob | null>;
  viewport: () => Viewport;
}

interface Props {
  items: StyledItem[];
  view: GraphView;
  settings: GraphSettings;
  selectedId: string | null;
  onViewCommit: (v: GraphView) => void;
}

const DASH: Record<string, number[]> = { solid: [], dashed: [10, 7], dotted: [1.5, 6] };

function vpFrom(view: GraphView, W: number, H: number): Viewport {
  const xspan = view.xspan;
  const yspan = view.yspan ?? (xspan * H) / Math.max(1, W);
  return { xmin: view.cx - xspan / 2, xmax: view.cx + xspan / 2, ymin: view.cy - yspan / 2, ymax: view.cy + yspan / 2, width: W, height: H };
}

function fmtCoord(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e7 || a < 1e-5)) return v.toExponential(4);
  return String(Number(v.toPrecision(7)));
}

export const GraphCanvas = forwardRef<GraphCanvasHandle, Props>(function GraphCanvas({ items, view, settings, selectedId, onViewCommit }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<GraphView>(view);
  const sizeRef = useRef({ W: 0, H: 0 });
  const rafRef = useRef(0);
  const cacheRef = useRef<Map<StyledItem, Polyline[]>>(new Map());
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [pinned, setPinned] = useState<Poi | null>(null);
  const [pois, setPois] = useState<Poi[]>([]);
  const [tick, setTick] = useState(0);
  const theme = useResolvedTheme();
  const dark = theme === 'dark';
  const commitTimer = useRef<number>(0);

  // sync external view changes (buttons, embed API, reset)
  useEffect(() => {
    viewRef.current = view;
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const schedule = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => setTick((t) => t + 1));
  };

  const commitSoon = () => {
    window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => onViewCommit(viewRef.current), 250);
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      sizeRef.current = { W: e.contentRect.width, H: e.contentRect.height };
      schedule();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // points of interest for the selected curve (computed when the view settles)
  useEffect(() => {
    setPinned(null);
    if (!settings.poi || !selectedId) {
      setPois([]);
      return;
    }
    const t = window.setTimeout(() => {
      const { W, H } = sizeRef.current;
      if (!W) return;
      const vp = vpFrom(viewRef.current, W, H);
      const visible = items.filter((s) => !s.hidden && s.item.kind === 'explicit').map((s) => s.item);
      const all = pointsOfInterest(visible, vp.xmin, vp.xmax, Math.min(1500, Math.ceil(W)));
      setPois(all.filter((p) => (p.itemId === selectedId || p.otherId === selectedId) && p.y >= vp.ymin && p.y <= vp.ymax));
    }, 180);
    return () => window.clearTimeout(t);
  }, [items, selectedId, settings.poi, view, tick === 0]);

  useImperativeHandle(ref, () => ({
    zoom: (f) => {
      const v = viewRef.current;
      viewRef.current = { ...v, xspan: v.xspan * f, yspan: v.yspan ? v.yspan * f : null };
      schedule();
      onViewCommit(viewRef.current);
    },
    toPNG: () => new Promise((res) => canvasRef.current ? canvasRef.current.toBlob(res, 'image/png') : res(null)),
    viewport: () => vpFrom(viewRef.current, sizeRef.current.W, sizeRef.current.H),
  }));

  // ---------------------------------------------------------------- render
  useEffect(() => {
    const c = canvasRef.current;
    const { W, H } = sizeRef.current;
    if (!c || !W || !H) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const vp = vpFrom(viewRef.current, W, H);
    const X = (x: number) => ((x - vp.xmin) / (vp.xmax - vp.xmin)) * W;
    const Y = (y: number) => H - ((y - vp.ymin) / (vp.ymax - vp.ymin)) * H;
    const clamp = (v: number) => (v < -1e5 ? -1e5 : v > 1e5 ? 1e5 : v);

    const bg = cssVar('--graph-bg');
    const minorC = cssVar('--graph-minor');
    const majorC = cssVar('--graph-major');
    const axisC = cssVar('--graph-axis');
    const textC = cssVar('--graph-text');
    const font = cssVar('--font-ui');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const sx = settings.piX ? piStep(vp.xmax - vp.xmin, W, 100) : niceStep(vp.xmax - vp.xmin, W, 100);
    const sy = niceStep(vp.ymax - vp.ymin, H, 100);

    // polar grid
    if (settings.polarGrid && settings.grid) {
      ctx.strokeStyle = majorC;
      ctx.lineWidth = 1;
      const maxR = Math.max(...[vp.xmin, vp.xmax].flatMap((x) => [vp.ymin, vp.ymax].map((y) => Math.hypot(x, y))));
      const step = niceStep(maxR, Math.max(W, H) / 2, 90);
      for (let r = step; r <= maxR; r += step) {
        ctx.beginPath();
        ctx.ellipse(X(0), Y(0), (r / (vp.xmax - vp.xmin)) * W, (r / (vp.ymax - vp.ymin)) * H, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (let a = 0; a < 12; a++) {
        const t = (a * Math.PI) / 6;
        ctx.beginPath();
        ctx.moveTo(X(0), Y(0));
        ctx.lineTo(X(Math.cos(t) * maxR), Y(Math.sin(t) * maxR));
        ctx.stroke();
      }
    } else if (settings.grid) {
      if (settings.minor) {
        ctx.strokeStyle = minorC;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const mx = sx / minorDivisions(sx);
        const my = sy / minorDivisions(sy);
        for (const v of ticks(vp.xmin, vp.xmax, mx)) {
          const p = Math.round(X(v)) + 0.5;
          ctx.moveTo(p, 0);
          ctx.lineTo(p, H);
        }
        for (const v of ticks(vp.ymin, vp.ymax, my)) {
          const p = Math.round(Y(v)) + 0.5;
          ctx.moveTo(0, p);
          ctx.lineTo(W, p);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = majorC;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const v of ticks(vp.xmin, vp.xmax, sx)) {
        const p = Math.round(X(v)) + 0.5;
        ctx.moveTo(p, 0);
        ctx.lineTo(p, H);
      }
      for (const v of ticks(vp.ymin, vp.ymax, sy)) {
        const p = Math.round(Y(v)) + 0.5;
        ctx.moveTo(0, p);
        ctx.lineTo(W, p);
      }
      ctx.stroke();
    }

    const ax = X(0);
    const ay = Y(0);
    if (settings.axes) {
      ctx.strokeStyle = axisC;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (ay >= 0 && ay <= H) {
        ctx.moveTo(0, Math.round(ay) + 0.5);
        ctx.lineTo(W, Math.round(ay) + 0.5);
      }
      if (ax >= 0 && ax <= W) {
        ctx.moveTo(Math.round(ax) + 0.5, 0);
        ctx.lineTo(Math.round(ax) + 0.5, H);
      }
      ctx.stroke();
    }

    // shaded regions first, curves on top
    const cache = new Map<StyledItem, Polyline[]>();
    for (const s of items) {
      if (s.hidden || s.item.kind !== 'inequality') continue;
      const color = adaptColor(s.color, dark);
      ctx.fillStyle = color;
      ctx.globalAlpha = s.fillOpacity ?? 0.2;
      const rects = inequalityRegion(s.item, vp, 3);
      ctx.beginPath();
      for (const r of rects) ctx.rect(X(r.x), Y(r.y + r.h), (r.w / (vp.xmax - vp.xmin)) * W + 0.5, (r.h / (vp.ymax - vp.ymin)) * H + 0.5);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    for (const s of items) {
      if (s.hidden) continue;
      const it = s.item;
      const color = adaptColor(s.color, dark);
      if (it.kind === 'points' && it.points) {
        ctx.fillStyle = color;
        for (const [px, py] of it.points) {
          if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
          ctx.beginPath();
          ctx.arc(X(px), Y(py), 5.5, 0, Math.PI * 2);
          ctx.fill();
        }
        continue;
      }
      if (!['explicit', 'explicitX', 'polar', 'parametric', 'implicit', 'inequality'].includes(it.kind)) continue;
      const polys = sampleItem(it, vp, settings.angle);
      cache.set(s, polys);
      ctx.strokeStyle = color;
      ctx.lineWidth = s.width ?? 2.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const strict = it.kind === 'inequality' && (it.op === '<' || it.op === '>');
      ctx.setLineDash(strict ? DASH.dashed : DASH[s.style ?? 'solid']);
      if (it.kind === 'inequality' && it.cond) continue; // chained: region only
      ctx.beginPath();
      for (const p of polys) {
        if (p.length === 2) {
          ctx.moveTo(X(p[0]) + 1, Y(p[1]));
          ctx.arc(X(p[0]), Y(p[1]), 1.2, 0, Math.PI * 2);
          continue;
        }
        ctx.moveTo(clamp(X(p[0])), clamp(Y(p[1])));
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(clamp(X(p[i])), clamp(Y(p[i + 1])));
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    cacheRef.current = cache;

    // axis numbers with a halo so they stay readable over curves
    if (settings.axes && settings.labels) {
      ctx.font = `12px ${font}`;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = bg;
      ctx.fillStyle = textC;
      const labelY = Math.min(Math.max(ay + 6, 4), H - 18);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const v of ticks(vp.xmin, vp.xmax, sx)) {
        if (Math.abs(v) < sx * 1e-6) continue;
        const t = tickLabel(v, sx, settings.piX);
        const px = X(v);
        ctx.strokeText(t, px, labelY);
        ctx.fillText(t, px, labelY);
      }
      ctx.textBaseline = 'middle';
      const leftSide = ax - 6 > 40;
      ctx.textAlign = leftSide ? 'right' : 'left';
      const labelX = leftSide ? Math.min(ax - 6, W - 6) : Math.max(ax + 6, 6);
      for (const v of ticks(vp.ymin, vp.ymax, sy)) {
        if (Math.abs(v) < sy * 1e-6) continue;
        const t = tickLabel(v, sy);
        const py = Y(v);
        ctx.strokeText(t, labelX, py);
        ctx.fillText(t, labelX, py);
      }
      if (ax > 0 && ax < W && ay > 0 && ay < H) {
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.strokeText('0', ax - 5, ay + 5);
        ctx.fillText('0', ax - 5, ay + 5);
      }
    }

    // points of interest
    const drawLabel = (px: number, py: number, text: string, color: string) => {
      ctx.font = `600 12px ${font}`;
      const w = ctx.measureText(text).width + 14;
      let bx = px + 10;
      let by = py - 30;
      if (bx + w > W - 4) bx = px - w - 10;
      if (by < 4) by = py + 10;
      ctx.fillStyle = cssVar('--surface');
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(bx, by, w, 22, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = cssVar('--text');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, bx + 7, by + 11);
    };
    for (const p of pois) {
      ctx.fillStyle = cssVar('--surface');
      ctx.strokeStyle = textC;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X(p.x), Y(p.y), 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (pinned) drawLabel(X(pinned.x), Y(pinned.y), `(${fmtCoord(pinned.x)}, ${fmtCoord(pinned.y)})`, textC);

    // trace
    if (hover) {
      let best: { d: number; x: number; y: number; color: string } | null = null;
      for (const [s, polys] of cache) {
        if (s.item.kind === 'inequality') continue;
        for (const p of polys) {
          for (let i = 0; i < p.length; i += 2) {
            const d = Math.hypot(X(p[i]) - hover.x, Y(p[i + 1]) - hover.y);
            if (d < 14 && (!best || d < best.d)) best = { d, x: p[i], y: p[i + 1], color: adaptColor(s.color, dark) };
          }
        }
      }
      // snap explicit curves exactly at the cursor's x
      if (best) {
        const hit = [...cache.keys()].find((s) => s.item.kind === 'explicit' && adaptColor(s.color, dark) === best!.color);
        if (hit?.item.fn) {
          const wx = vp.xmin + (hover.x / W) * (vp.xmax - vp.xmin);
          const wy = hit.item.fn(wx);
          if (Number.isFinite(wy) && Math.abs(Y(wy) - hover.y) < 20) best = { ...best, x: wx, y: wy };
        }
        ctx.fillStyle = best.color;
        ctx.beginPath();
        ctx.arc(X(best.x), Y(best.y), 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = bg;
        ctx.lineWidth = 2;
        ctx.stroke();
        drawLabel(X(best.x), Y(best.y), `(${fmtCoord(best.x)}, ${fmtCoord(best.y)})`, best.color);
      }
    }
  }, [tick, items, settings, dark, theme, hover, pois, pinned]);

  // ---------------------------------------------------------------- interaction
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: GraphView; x: number; y: number; dist?: number; mid?: { x: number; y: number }; moved: boolean } | null>(null);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    canvasRef.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    if (pts.length === 1) gesture.current = { view: viewRef.current, x: pts[0].x, y: pts[0].y, moved: false };
    else if (pts.length === 2) {
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      gesture.current = { view: viewRef.current, x: mid.x, y: mid.y, dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), mid, moved: true };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e);
    if (e.pointerType === 'mouse' && !gesture.current) setHover(p);
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    const { W, H } = sizeRef.current;
    const v0 = vpFrom(g.view, W, H);
    const ux = (v0.xmax - v0.xmin) / W;
    const uy = (v0.ymax - v0.ymin) / H;
    const pts = [...pointers.current.values()];
    if (pts.length >= 2 && g.dist) {
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const k = g.dist / Math.max(10, dist);
      // world point under the original midpoint stays under the new midpoint
      const wx = v0.xmin + g.mid!.x * ux;
      const wy = v0.ymax - g.mid!.y * uy;
      const xspan = g.view.xspan * k;
      const yspan = g.view.yspan ? g.view.yspan * k : null;
      const nyspan = yspan ?? (xspan * H) / W;
      const cx = wx - (mid.x / W - 0.5) * xspan;
      const cy = wy + (mid.y / H - 0.5) * nyspan;
      viewRef.current = { cx, cy, xspan, yspan };
    } else {
      const dx = p.x - g.x;
      const dy = p.y - g.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true;
      viewRef.current = { ...g.view, cx: g.view.cx - dx * ux, cy: g.view.cy + dy * uy };
      if (e.pointerType !== 'mouse') setHover(null);
    }
    schedule();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      if (g && !g.moved) {
        // tap / click: pin a point of interest or show trace on touch
        const p = local(e);
        const { W, H } = sizeRef.current;
        const vp = vpFrom(viewRef.current, W, H);
        const X = (x: number) => ((x - vp.xmin) / (vp.xmax - vp.xmin)) * W;
        const Y = (y: number) => H - ((y - vp.ymin) / (vp.ymax - vp.ymin)) * H;
        const hit = pois.find((q) => Math.hypot(X(q.x) - p.x, Y(q.y) - p.y) < 14);
        setPinned(hit ?? null);
        if (e.pointerType !== 'mouse') setHover(hit ? null : p);
      }
      gesture.current = null;
      commitSoon();
    } else if (pointers.current.size === 1) {
      const pt = [...pointers.current.values()][0];
      gesture.current = { view: viewRef.current, x: pt.x, y: pt.y, moved: true };
    }
  };

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { W, H } = sizeRef.current;
      const p = local(e);
      const v = viewRef.current;
      const vp = vpFrom(v, W, H);
      const k = Math.exp((e.ctrlKey ? e.deltaY * 3 : e.deltaY) * 0.0012);
      const wx = vp.xmin + (p.x / W) * (vp.xmax - vp.xmin);
      const wy = vp.ymax - (p.y / H) * (vp.ymax - vp.ymin);
      const xspan = Math.min(1e12, Math.max(1e-9, v.xspan * k));
      const yspan = v.yspan ? Math.min(1e12, Math.max(1e-9, v.yspan * k)) : null;
      const nyspan = yspan ?? (xspan * H) / W;
      viewRef.current = { cx: wx - (p.x / W - 0.5) * xspan, cy: wy + (p.y / H - 0.5) * nyspan, xspan, yspan };
      schedule();
      commitSoon();
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={wrapRef} className="graph-canvas-wrap">
      <canvas
        ref={canvasRef}
        className="graph-canvas"
        role="img"
        aria-label="Graph"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}
        onKeyDown={(e) => {
          const v = viewRef.current;
          const step = v.xspan / 10;
          const ys = (v.yspan ?? v.xspan) / 10;
          const map: Record<string, Partial<GraphView>> = {
            ArrowLeft: { cx: v.cx - step },
            ArrowRight: { cx: v.cx + step },
            ArrowUp: { cy: v.cy + ys },
            ArrowDown: { cy: v.cy - ys },
          };
          if (map[e.key]) {
            e.preventDefault();
            viewRef.current = { ...v, ...map[e.key] };
            schedule();
            commitSoon();
          } else if (e.key === '+' || e.key === '=') {
            viewRef.current = { ...v, xspan: v.xspan / 1.25, yspan: v.yspan ? v.yspan / 1.25 : null };
            schedule();
            commitSoon();
          } else if (e.key === '-') {
            viewRef.current = { ...v, xspan: v.xspan * 1.25, yspan: v.yspan ? v.yspan * 1.25 : null };
            schedule();
            commitSoon();
          }
        }}
      />
      {pois.length > 0 && !pinned && <div className="graph-hint">Tap a grey point to see its coordinates</div>}
    </div>
  );
});
