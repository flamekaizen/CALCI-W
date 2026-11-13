/** Points of interest on curves: roots, extrema, intercepts, intersections. */
import type { NumFn } from '../compile.js';
import { brent, findRoots, clean } from '../numerics.js';
import type { CompiledItem } from './parse.js';

export type PoiKind = 'root' | 'max' | 'min' | 'y-intercept' | 'intersection';

export interface Poi {
  x: number;
  y: number;
  kind: PoiKind;
  itemId: string;
  otherId?: string;
}

const slope = (f: NumFn, x: number, h: number) => (f(x + h) - f(x - h)) / (2 * h);

/** Extrema of y = f(x) on [a, b] from sign changes of a numeric derivative. */
export function extrema(f: NumFn, a: number, b: number, samples = 800): { x: number; y: number; kind: 'max' | 'min' }[] {
  const out: { x: number; y: number; kind: 'max' | 'min' }[] = [];
  const h = (b - a) * 1e-7;
  const step = (b - a) / samples;
  // jittered grid so a sample never lands exactly on a stationary point
  const off = step * 0.3819660112501051;
  let x0 = a + off - step;
  let d0 = slope(f, x0, h);
  for (let i = 0; i <= samples; i++) {
    const x1 = a + off + i * step;
    const d1 = slope(f, x1, h);
    if (Number.isFinite(d0) && Number.isFinite(d1) && d0 * d1 < 0) {
      const xr = brent((x) => slope(f, x, h), x0, x1, 1e-13);
      const y = f(xr);
      // reject spikes at discontinuities: neighbours must be finite & close
      const yl = f(xr - step);
      const yr = f(xr + step);
      if (Number.isFinite(y) && Number.isFinite(yl) && Number.isFinite(yr)) {
        const kind = d0 > 0 ? 'max' : 'min';
        if ((kind === 'max' && y >= yl && y >= yr) || (kind === 'min' && y <= yl && y <= yr)) out.push({ x: clean(xr, 10), y: clean(y, 10), kind });
      }
    }
    x0 = x1;
    d0 = d1;
  }
  return out;
}

/** Points of interest for explicit curves visible in [xmin, xmax]. */
export function pointsOfInterest(items: CompiledItem[], xmin: number, xmax: number, samples = 1200): Poi[] {
  const pois: Poi[] = [];
  const explicit = items.filter((it) => it.kind === 'explicit' && it.fn);
  for (const it of explicit) {
    const f = it.restrict ? (x: number) => (it.restrict!(x, it.fn!(x), x, x) ? it.fn!(x) : NaN) : it.fn!;
    for (const r of findRoots(f, xmin, xmax, samples)) pois.push({ x: clean(r, 10), y: 0, kind: 'root', itemId: it.id });
    for (const e of extrema(f, xmin, xmax, samples)) pois.push({ ...e, itemId: it.id });
    if (xmin <= 0 && xmax >= 0) {
      const y0 = f(0);
      if (Number.isFinite(y0)) pois.push({ x: 0, y: clean(y0, 10), kind: 'y-intercept', itemId: it.id });
    }
  }
  for (let i = 0; i < explicit.length; i++) {
    for (let j = i + 1; j < explicit.length; j++) {
      const f = explicit[i].fn!;
      const g = explicit[j].fn!;
      const d = (x: number) => f(x) - g(x);
      for (const r of findRoots(d, xmin, xmax, samples)) {
        const y = f(r);
        if (Number.isFinite(y)) pois.push({ x: clean(r, 10), y: clean(y, 10), kind: 'intersection', itemId: explicit[i].id, otherId: explicit[j].id });
      }
    }
  }
  return pois;
}
