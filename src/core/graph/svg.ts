/** Server-safe SVG renderer for graphs (used by the REST API and exports). */
import { compileGraph, type GraphLine } from './parse.js';
import { sampleItem, inequalityRegion, type Viewport } from './sample.js';
import { niceStep, ticks, tickLabel, minorDivisions, piStep } from './ticks.js';
import { curveColor } from './palette.js';

export interface SvgOptions {
  width?: number;
  height?: number;
  xmin?: number;
  xmax?: number;
  ymin?: number;
  ymax?: number;
  theme?: 'light' | 'dark';
  grid?: boolean;
  axes?: boolean;
  piAxis?: boolean;
  angle?: 'rad' | 'deg' | 'grad';
  colors?: string[];
  lineWidth?: number;
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

export function renderSvg(expressions: string[], o: SvgOptions = {}): string {
  const W = Math.min(2000, Math.max(50, o.width ?? 800));
  const H = Math.min(2000, Math.max(50, o.height ?? 600));
  const xmin = o.xmin ?? -10;
  const xmax = o.xmax ?? 10;
  const aspect = H / W;
  const yr = ((xmax - xmin) * aspect) / 2;
  const ymin = o.ymin ?? -yr;
  const ymax = o.ymax ?? yr;
  const dark = o.theme === 'dark';
  const bg = dark ? '#0f1218' : '#ffffff';
  const minorC = dark ? '#1c222c' : '#f0f2f5';
  const majorC = dark ? '#2a3240' : '#dde1e7';
  const axisC = dark ? '#8a93a3' : '#3b4250';
  const textC = dark ? '#9aa3b2' : '#5b6372';
  const vp: Viewport = { xmin, xmax, ymin, ymax, width: W, height: H };
  const X = (x: number) => ((x - xmin) / (xmax - xmin)) * W;
  const Y = (y: number) => H - ((y - ymin) / (ymax - ymin)) * H;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" fill="${bg}"/>`);

  const sx = o.piAxis ? piStep(xmax - xmin, W) : niceStep(xmax - xmin, W);
  const sy = niceStep(ymax - ymin, H);
  if (o.grid !== false) {
    const mx = sx / minorDivisions(sx);
    const my = sy / minorDivisions(sy);
    let minor = '';
    for (const v of ticks(xmin, xmax, mx)) minor += `M${r2(X(v))} 0V${H}`;
    for (const v of ticks(ymin, ymax, my)) minor += `M0 ${r2(Y(v))}H${W}`;
    parts.push(`<path d="${minor}" stroke="${minorC}" stroke-width="1"/>`);
    let major = '';
    for (const v of ticks(xmin, xmax, sx)) major += `M${r2(X(v))} 0V${H}`;
    for (const v of ticks(ymin, ymax, sy)) major += `M0 ${r2(Y(v))}H${W}`;
    parts.push(`<path d="${major}" stroke="${majorC}" stroke-width="1"/>`);
  }
  if (o.axes !== false) {
    const ax = Math.min(Math.max(X(0), 0), W);
    const ay = Math.min(Math.max(Y(0), 0), H);
    parts.push(`<path d="M0 ${r2(ay)}H${W}M${r2(ax)} 0V${H}" stroke="${axisC}" stroke-width="1.5"/>`);
    const labels: string[] = [];
    for (const v of ticks(xmin, xmax, sx)) if (v !== 0) labels.push(`<text x="${r2(X(v))}" y="${r2(Math.min(H - 4, ay + 16))}" text-anchor="middle">${esc(tickLabel(v, sx, o.piAxis))}</text>`);
    for (const v of ticks(ymin, ymax, sy)) if (v !== 0) labels.push(`<text x="${r2(Math.max(4, ax - 6))}" y="${r2(Y(v) + 4)}" text-anchor="${ax - 6 < 30 ? 'start' : 'end'}">${esc(tickLabel(v, sy))}</text>`);
    labels.push(`<text x="${r2(ax - 6)}" y="${r2(ay + 16)}" text-anchor="end">0</text>`);
    parts.push(`<g fill="${textC}" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="12">${labels.join('')}</g>`);
  }

  const lines: GraphLine[] = expressions.map((text, i) => ({ id: String(i), text }));
  const g = compileGraph(lines, { angle: o.angle });
  const lw = o.lineWidth ?? 2.5;
  g.items.forEach((it, i) => {
    const color = o.colors?.[i] ?? curveColor(i, dark);
    if (it.kind === 'inequality') {
      const rects = inequalityRegion(it, vp, 3);
      let d = '';
      for (const r of rects) d += `M${r2(X(r.x))} ${r2(Y(r.y + r.h))}h${r2((r.w / (xmax - xmin)) * W)}v${r2((r.h / (ymax - ymin)) * H)}h${r2((-r.w / (xmax - xmin)) * W)}z`;
      parts.push(`<path d="${d}" fill="${color}" fill-opacity="0.18" shape-rendering="crispEdges"/>`);
    }
    if (it.kind === 'points' && it.points) {
      for (const [px, py] of it.points) if (Number.isFinite(px) && Number.isFinite(py)) parts.push(`<circle cx="${r2(X(px))}" cy="${r2(Y(py))}" r="5" fill="${color}"/>`);
      return;
    }
    const polys = sampleItem(it, vp, o.angle);
    if (!polys.length) return;
    let d = '';
    for (const p of polys) {
      for (let k = 0; k < p.length; k += 2) {
        const px = Math.max(-1e5, Math.min(1e5, X(p[k])));
        const py = Math.max(-1e5, Math.min(1e5, Y(p[k + 1])));
        d += `${k === 0 ? 'M' : 'L'}${r2(px)} ${r2(py)}`;
      }
    }
    const dash = it.kind === 'inequality' && (it.op === '<' || it.op === '>') ? ' stroke-dasharray="8 6"' : '';
    parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${lw}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}
