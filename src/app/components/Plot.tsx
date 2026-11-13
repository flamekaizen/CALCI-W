import { useEffect, useMemo, useRef, useState } from 'react';
import { niceStep, ticks, tickLabel } from '../../core/graph/ticks';
import { sampleExplicit } from '../../core/graph/sample';
import { cssVar, useResolvedTheme, useSize } from '../ui';
import { adaptColor } from '../../core/graph/palette';

export type Series =
  | { type: 'fn'; f: (x: number) => number; color: string; width?: number; dash?: number[]; label?: string }
  | { type: 'points'; pts: [number, number][]; color: string; r?: number; label?: string }
  | { type: 'line'; pts: [number, number][]; color: string; width?: number; dash?: number[]; label?: string }
  | { type: 'bars'; bars: { x0: number; x1: number; y: number }[]; color: string; opacity?: number; label?: string }
  | { type: 'area'; f: (x: number) => number; a: number; b: number; color: string; opacity?: number; label?: string }
  | { type: 'vline'; x: number; color: string; dash?: number[]; label?: string }
  | { type: 'hline'; y: number; color: string; dash?: number[]; label?: string };

export interface PlotProps {
  series: Series[];
  x: [number, number];
  y?: [number, number];
  height?: number;
  interactive?: boolean;
  /** Pad auto y-range (fraction). */
  pad?: number;
  ariaLabel?: string;
  xLabel?: string;
  yLabel?: string;
}

function autoY(series: Series[], x: [number, number], pad: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  const take = (v: number) => {
    if (Number.isFinite(v)) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  };
  for (const s of series) {
    if (s.type === 'fn' || s.type === 'area') {
      const vals: number[] = [];
      for (let i = 0; i <= 200; i++) vals.push(s.f(x[0] + ((x[1] - x[0]) * i) / 200));
      const fin = vals.filter(Number.isFinite).sort((a, b) => a - b);
      if (fin.length) {
        // robust range: ignore extreme 2% (asymptotes)
        take(fin[Math.floor(fin.length * 0.02)]);
        take(fin[Math.ceil(fin.length * 0.98) - 1]);
      }
    } else if (s.type === 'points' || s.type === 'line') s.pts.forEach(([, v]) => take(v));
    else if (s.type === 'bars') s.bars.forEach((b) => (take(b.y), take(0)));
    else if (s.type === 'hline') take(s.y);
  }
  if (!Number.isFinite(lo)) return [-1, 1];
  if (lo === hi) return [lo - 1, hi + 1];
  const p = (hi - lo) * pad;
  return [lo - p, hi + p];
}

export function Plot({ series, x, y, height = 280, interactive = true, pad = 0.08, ariaLabel = 'Chart', xLabel, yLabel }: PlotProps) {
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useResolvedTheme();
  const dark = theme === 'dark';
  const baseY = useMemo(() => y ?? autoY(series, x, pad), [series, x, y, pad]);
  const [view, setView] = useState<{ x: [number, number]; y: [number, number] } | null>(null);
  const [hover, setHover] = useState<{ px: number; py: number } | null>(null);
  useEffect(() => setView(null), [x[0], x[1], baseY[0], baseY[1]]);
  const vx = view?.x ?? x;
  const vy = view?.y ?? baseY;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !size.width) return;
    const dpr = window.devicePixelRatio || 1;
    const W = size.width;
    const H = height;
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const padL = 44;
    const padB = 24;
    const padT = 8;
    const padR = 10;
    const pw = W - padL - padR;
    const ph = H - padT - padB;
    const X = (v: number) => padL + ((v - vx[0]) / (vx[1] - vx[0])) * pw;
    const Y = (v: number) => padT + ph - ((v - vy[0]) / (vy[1] - vy[0])) * ph;
    ctx.clearRect(0, 0, W, H);
    const gridC = cssVar('--graph-major');
    const axisC = cssVar('--graph-axis');
    const textC = cssVar('--graph-text');
    ctx.font = '11px ' + cssVar('--font-ui');
    const sx = niceStep(vx[1] - vx[0], pw, 80);
    const sy = niceStep(vy[1] - vy[0], ph, 50);
    ctx.strokeStyle = gridC;
    ctx.lineWidth = 1;
    ctx.fillStyle = textC;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const t of ticks(vx[0], vx[1], sx)) {
      const px = Math.round(X(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, padT);
      ctx.lineTo(px, padT + ph);
      ctx.stroke();
      ctx.fillText(tickLabel(t, sx), px, padT + ph + 6);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const t of ticks(vy[0], vy[1], sy)) {
      const py = Math.round(Y(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padL, py);
      ctx.lineTo(padL + pw, py);
      ctx.stroke();
      ctx.fillText(tickLabel(t, sy), padL - 6, py);
    }
    ctx.strokeStyle = axisC;
    ctx.lineWidth = 1.25;
    if (vy[0] <= 0 && vy[1] >= 0) {
      ctx.beginPath();
      ctx.moveTo(padL, Y(0));
      ctx.lineTo(padL + pw, Y(0));
      ctx.stroke();
    }
    if (vx[0] <= 0 && vx[1] >= 0) {
      ctx.beginPath();
      ctx.moveTo(X(0), padT);
      ctx.lineTo(X(0), padT + ph);
      ctx.stroke();
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(padL, padT, pw, ph);
    ctx.clip();
    const vp = { xmin: vx[0], xmax: vx[1], ymin: vy[0], ymax: vy[1], width: pw, height: ph };
    const clampY = (v: number) => Math.max(-1e4, Math.min(1e4, Y(v)));
    for (const s of series) {
      const color = adaptColor(s.color, dark);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.setLineDash([]);
      switch (s.type) {
        case 'area': {
          ctx.globalAlpha = s.opacity ?? 0.22;
          const a = Math.max(s.a, vx[0]);
          const b = Math.min(s.b, vx[1]);
          if (b > a) {
            const n = Math.max(2, Math.ceil(((b - a) / (vx[1] - vx[0])) * pw));
            ctx.beginPath();
            ctx.moveTo(X(a), clampY(0));
            for (let i = 0; i <= n; i++) {
              const t = a + ((b - a) * i) / n;
              const v = s.f(t);
              ctx.lineTo(X(t), clampY(Number.isFinite(v) ? v : 0));
            }
            ctx.lineTo(X(b), clampY(0));
            ctx.closePath();
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          break;
        }
        case 'bars':
          ctx.globalAlpha = s.opacity ?? 0.75;
          for (const bar of s.bars) {
            const x0 = X(bar.x0);
            const x1 = X(bar.x1);
            const y0 = clampY(0);
            const y1 = clampY(bar.y);
            ctx.fillRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1), Math.max(1, Math.abs(x1 - x0) - 1), Math.abs(y1 - y0));
          }
          ctx.globalAlpha = 1;
          break;
        case 'fn': {
          ctx.lineWidth = s.width ?? 2.25;
          ctx.setLineDash(s.dash ?? []);
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.beginPath();
          for (const poly of sampleExplicit(s.f, vp)) {
            for (let i = 0; i < poly.length; i += 2) {
              const px = X(poly[i]);
              const py = clampY(poly[i + 1]);
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
          }
          ctx.stroke();
          break;
        }
        case 'line': {
          ctx.lineWidth = s.width ?? 2;
          ctx.setLineDash(s.dash ?? []);
          ctx.beginPath();
          s.pts.forEach(([a, b], i) => (i ? ctx.lineTo(X(a), clampY(b)) : ctx.moveTo(X(a), clampY(b))));
          ctx.stroke();
          break;
        }
        case 'points':
          for (const [a, b] of s.pts) {
            if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
            ctx.beginPath();
            ctx.arc(X(a), Y(b), s.r ?? 4, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        case 'vline':
          ctx.lineWidth = 1.5;
          ctx.setLineDash(s.dash ?? [5, 4]);
          ctx.beginPath();
          ctx.moveTo(X(s.x), padT);
          ctx.lineTo(X(s.x), padT + ph);
          ctx.stroke();
          break;
        case 'hline':
          ctx.lineWidth = 1.5;
          ctx.setLineDash(s.dash ?? [5, 4]);
          ctx.beginPath();
          ctx.moveTo(padL, Y(s.y));
          ctx.lineTo(padL + pw, Y(s.y));
          ctx.stroke();
          break;
      }
    }
    ctx.setLineDash([]);
    // hover readout
    if (hover && hover.px >= padL && hover.px <= padL + pw) {
      const hx = vx[0] + ((hover.px - padL) / pw) * (vx[1] - vx[0]);
      ctx.strokeStyle = textC;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(hover.px) + 0.5, padT);
      ctx.lineTo(Math.round(hover.px) + 0.5, padT + ph);
      ctx.stroke();
      ctx.globalAlpha = 1;
      const lines: { text: string; color: string }[] = [{ text: `x = ${fmtShort(hx)}`, color: textC }];
      for (const s of series) {
        if (s.type !== 'fn') continue;
        const v = s.f(hx);
        if (!Number.isFinite(v)) continue;
        const color = adaptColor(s.color, dark);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(X(hx), Y(v), 4, 0, Math.PI * 2);
        ctx.fill();
        lines.push({ text: `${s.label ?? 'y'} = ${fmtShort(v)}`, color });
      }
      ctx.restore();
      ctx.save();
      ctx.font = '12px ' + cssVar('--font-ui');
      const bw = Math.max(...lines.map((l) => ctx.measureText(l.text).width)) + 16;
      const bh = lines.length * 17 + 8;
      let bx = hover.px + 12;
      if (bx + bw > W - 4) bx = hover.px - bw - 12;
      const by = padT + 6;
      ctx.fillStyle = cssVar('--surface');
      ctx.strokeStyle = cssVar('--border');
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 8);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      lines.forEach((l, i) => {
        ctx.fillStyle = l.color;
        ctx.fillText(l.text, bx + 8, by + 6 + i * 17);
      });
    }
    ctx.restore();
    if (xLabel || yLabel) {
      ctx.fillStyle = textC;
      ctx.font = '11px ' + cssVar('--font-ui');
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      if (xLabel) ctx.fillText(xLabel, padL + pw, padT + ph - 4);
      if (yLabel) {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(yLabel, padL + 6, padT + 4);
      }
    }
  }, [series, vx, vy, size.width, height, hover, dark, theme, xLabel, yLabel]);

  // interaction: drag to pan, wheel to zoom
  const drag = useRef<{ x: number; y: number; vx: [number, number]; vy: [number, number] } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, vx, vy };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    setHover({ px: e.clientX - rect.left, py: e.clientY - rect.top });
    const d = drag.current;
    if (!d) return;
    const pw = size.width - 54;
    const ph = height - 32;
    const dx = ((e.clientX - d.x) / pw) * (d.vx[1] - d.vx[0]);
    const dy = ((e.clientY - d.y) / ph) * (d.vy[1] - d.vy[0]);
    setView({ x: [d.vx[0] - dx, d.vx[1] - dx], y: [d.vy[0] + dy, d.vy[1] + dy] });
  };
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !interactive) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const fx = (e.clientX - rect.left - 44) / (rect.width - 54);
      const fy = 1 - (e.clientY - rect.top - 8) / (height - 32);
      const k = Math.exp(e.deltaY * 0.0015);
      setView((v) => {
        const cx = v?.x ?? x;
        const cy = v?.y ?? baseY;
        const ax = cx[0] + fx * (cx[1] - cx[0]);
        const ay = cy[0] + fy * (cy[1] - cy[0]);
        return { x: [ax + (cx[0] - ax) * k, ax + (cx[1] - ax) * k], y: [ay + (cy[0] - ay) * k, ay + (cy[1] - ay) * k] };
      });
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [interactive, x, baseY, height]);

  return (
    <div ref={wrapRef} className="plot" style={{ position: 'relative', height }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        style={{ width: '100%', height, display: 'block', cursor: interactive ? (drag.current ? 'grabbing' : 'crosshair') : 'default', touchAction: interactive ? 'none' : 'auto' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => {
          drag.current = null;
          setHover(null);
        }}
        onDoubleClick={() => setView(null)}
      />
    </div>
  );
}

function fmtShort(v: number) {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-4)) return v.toExponential(3);
  return String(Number(v.toPrecision(6)));
}
