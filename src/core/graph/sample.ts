/**
 * Curve sampling in world coordinates, independent of any renderer.
 * Output polylines are flat arrays [x0, y0, x1, y1, ...].
 */
import type { NumFn } from '../compile.js';
import type { CompiledItem, IneqOp } from './parse.js';

export interface Viewport {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  /** Pixel size of the drawing surface. */
  width: number;
  height: number;
}

export type Polyline = number[];

const finite = Number.isFinite;

/**
 * Adaptive sampling of y = f(x) (or x = f(y) when axis === 'x').
 * Splits intervals where the curve deviates from a straight line by more than
 * `tolPx`, and breaks the polyline at asymptotes and domain gaps.
 */
export function sampleExplicit(f: NumFn, vp: Viewport, axis: 'y' | 'x' = 'y', restrict?: NumFn): Polyline[] {
  const [a, b, pxRange, unitsRange] = axis === 'y' ? [vp.xmin, vp.xmax, vp.height, vp.ymax - vp.ymin] : [vp.ymin, vp.ymax, vp.width, vp.xmax - vp.xmin];
  const n = Math.max(32, Math.ceil(axis === 'y' ? vp.width : vp.height));
  const s = pxRange / unitsRange; // px per unit of the dependent axis
  const tolPx = 0.35;
  const MAXD = 11;
  const segs: Polyline[] = [];
  let cur: number[] = [];
  const ev = (t: number) => {
    const v = f(t);
    if (restrict) {
      const ok = axis === 'y' ? restrict(t, v, t, t) : restrict(v, t, t, t);
      if (!ok) return NaN;
    }
    return v;
  };
  const push = (t: number, v: number) => {
    if (axis === 'y') cur.push(t, v);
    else cur.push(v, t);
  };
  const flush = () => {
    if (cur.length >= 4) segs.push(cur);
    else if (cur.length === 2) segs.push(cur); // isolated point
    cur = [];
  };
  const refine = (ta: number, va: number, tb: number, vb: number, d: number) => {
    const fa = finite(va);
    const fb = finite(vb);
    if (fa && fb) {
      if (d < MAXD) {
        const tm = (ta + tb) / 2;
        const vm = ev(tm);
        if (!finite(vm)) {
          refine(ta, va, tm, vm, d + 1);
          refine(tm, vm, tb, vb, d + 1);
          return;
        }
        const dev = Math.abs(vm - (va + vb) / 2) * s;
        const span = Math.abs(vb - va) * s;
        if (dev > tolPx || (span > pxRange && d < MAXD - 1)) {
          refine(ta, va, tm, vm, d + 1);
          refine(tm, vm, tb, vb, d + 1);
          return;
        }
      } else if (Math.abs(vb - va) * s > pxRange * 0.5) {
        // jump that survives maximum refinement → discontinuity
        flush();
        push(tb, vb);
        return;
      }
      push(tb, vb);
      return;
    }
    if (!fa && !fb) {
      if (d < 3) {
        const tm = (ta + tb) / 2;
        const vm = ev(tm);
        if (finite(vm)) {
          refine(ta, va, tm, vm, d + 1);
          refine(tm, vm, tb, vb, d + 1);
          return;
        }
      }
      flush();
      return;
    }
    // exactly one end is finite: locate the domain edge
    if (d < MAXD + 4) {
      const tm = (ta + tb) / 2;
      const vm = ev(tm);
      refine(ta, va, tm, vm, d + 1);
      refine(tm, vm, tb, vb, d + 1);
      return;
    }
    if (fb) {
      flush();
      push(tb, vb);
    } else flush();
  };
  let t0 = a;
  let v0 = ev(a);
  if (finite(v0)) push(t0, v0);
  const step = (b - a) / n;
  for (let i = 1; i <= n; i++) {
    const t1 = a + i * step;
    const v1 = ev(t1);
    refine(t0, v0, t1, v1, 0);
    t0 = t1;
    v0 = v1;
  }
  flush();
  return segs;
}

/** Parametric sampling of (fx(t), fy(t)) for t in [t0, t1]. */
export function sampleParametric(fx: NumFn, fy: NumFn, t0: number, t1: number, vp: Viewport, restrict?: NumFn): Polyline[] {
  const sx = vp.width / (vp.xmax - vp.xmin);
  const sy = vp.height / (vp.ymax - vp.ymin);
  const n = 1000;
  const MAXD = 9;
  const segs: Polyline[] = [];
  let cur: number[] = [];
  const ev = (t: number): [number, number] => {
    const x = fx(t);
    const y = fy(t);
    if (restrict && !restrict(x, y, t, t)) return [NaN, NaN];
    return [x, y];
  };
  const flush = () => {
    if (cur.length >= 2) segs.push(cur);
    cur = [];
  };
  const refine = (ta: number, pa: [number, number], tb: number, pb: [number, number], d: number) => {
    const fa = finite(pa[0]) && finite(pa[1]);
    const fb = finite(pb[0]) && finite(pb[1]);
    if (fa && fb) {
      const dist = Math.hypot((pb[0] - pa[0]) * sx, (pb[1] - pa[1]) * sy);
      if (dist > 2 && d < MAXD) {
        const tm = (ta + tb) / 2;
        const pm = ev(tm);
        refine(ta, pa, tm, pm, d + 1);
        refine(tm, pm, tb, pb, d + 1);
        return;
      }
      if (dist > Math.max(vp.width, vp.height) * 0.5 && d >= MAXD) {
        flush();
        cur.push(pb[0], pb[1]);
        return;
      }
      cur.push(pb[0], pb[1]);
      return;
    }
    if (!fa && !fb) {
      flush();
      return;
    }
    if (d < MAXD) {
      const tm = (ta + tb) / 2;
      const pm = ev(tm);
      refine(ta, pa, tm, pm, d + 1);
      refine(tm, pm, tb, pb, d + 1);
      return;
    }
    if (fb) {
      flush();
      cur.push(pb[0], pb[1]);
    } else flush();
  };
  let ta = t0;
  let pa = ev(ta);
  if (finite(pa[0]) && finite(pa[1])) cur.push(pa[0], pa[1]);
  for (let i = 1; i <= n; i++) {
    const tb = t0 + ((t1 - t0) * i) / n;
    const pb = ev(tb);
    refine(ta, pa, tb, pb, 0);
    ta = tb;
    pa = pb;
  }
  flush();
  return segs;
}

/** Polar r = f(theta); `toRad` converts the user's angle unit to radians. */
export function samplePolar(f: NumFn, t0: number, t1: number, vp: Viewport, toRad = 1, restrict?: NumFn): Polyline[] {
  return sampleParametric(
    (t) => f(t) * Math.cos(t * toRad),
    (t) => f(t) * Math.sin(t * toRad),
    t0,
    t1,
    vp,
    restrict,
  );
}

/**
 * Marching squares on F(x, y) = 0 with local refinement. Returns line segments
 * as polylines of 2 points each (renderers can batch them in one path).
 */
export function sampleImplicit(F: NumFn, vp: Viewport, restrict?: NumFn, cellPx = 8, levels = 2): Polyline[] {
  const cols = Math.max(8, Math.ceil(vp.width / cellPx));
  const rows = Math.max(8, Math.ceil(vp.height / cellPx));
  const dx = (vp.xmax - vp.xmin) / cols;
  const dy = (vp.ymax - vp.ymin) / rows;
  const ev = (x: number, y: number) => {
    const v = F(x, y);
    if (restrict && !restrict(x, y, 0, 0)) return NaN;
    return v;
  };
  const grid = new Float64Array((cols + 1) * (rows + 1));
  for (let j = 0; j <= rows; j++) {
    const y = vp.ymin + j * dy;
    for (let i = 0; i <= cols; i++) grid[j * (cols + 1) + i] = ev(vp.xmin + i * dx, y);
  }
  const out: Polyline[] = [];
  const cell = (x0: number, y0: number, w: number, h: number, v00: number, v10: number, v01: number, v11: number, level: number) => {
    if (!(finite(v00) && finite(v10) && finite(v01) && finite(v11))) {
      if (level > 0) {
        // split anyway; NaN regions may hide a crossing
        subdivide(x0, y0, w, h, v00, v10, v01, v11, level);
      }
      return;
    }
    const s00 = v00 > 0;
    const s10 = v10 > 0;
    const s01 = v01 > 0;
    const s11 = v11 > 0;
    const mixed = !(s00 === s10 && s10 === s01 && s01 === s11);
    if (!mixed) {
      // could still contain a small closed curve or tangency; check centre once at coarse level
      if (level === levels) {
        const vc = ev(x0 + w / 2, y0 + h / 2);
        if (finite(vc) && vc > 0 !== s00) subdivide(x0, y0, w, h, v00, v10, v01, v11, level);
      }
      return;
    }
    if (level > 0) {
      subdivide(x0, y0, w, h, v00, v10, v01, v11, level);
      return;
    }
    // final level: emit segments
    const interp = (a: number, b: number) => a / (a - b);
    const pts: [number, number][] = [];
    // edges: bottom (00-10), right (10-11), top (01-11), left (00-01)
    if (s00 !== s10) pts.push([x0 + w * interp(v00, v10), y0]);
    if (s10 !== s11) pts.push([x0 + w, y0 + h * interp(v10, v11)]);
    if (s01 !== s11) pts.push([x0 + w * interp(v01, v11), y0 + h]);
    if (s00 !== s01) pts.push([x0, y0 + h * interp(v00, v01)]);
    const scale = Math.max(Math.abs(v00), Math.abs(v10), Math.abs(v01), Math.abs(v11));
    const accept = (p: [number, number], q: [number, number]) => {
      const vm = ev((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
      // reject sign changes through poles (|F| large at the "zero")
      if (!finite(vm) || Math.abs(vm) > scale * 2) return;
      out.push([p[0], p[1], q[0], q[1]]);
    };
    if (pts.length === 2) accept(pts[0], pts[1]);
    else if (pts.length === 4) {
      const vc = ev(x0 + w / 2, y0 + h / 2);
      if (vc > 0 === s00) {
        accept(pts[0], pts[1]);
        accept(pts[2], pts[3]);
      } else {
        accept(pts[0], pts[3]);
        accept(pts[1], pts[2]);
      }
    }
  };
  const subdivide = (x0: number, y0: number, w: number, h: number, v00: number, v10: number, v01: number, v11: number, level: number) => {
    const hw = w / 2;
    const hh = h / 2;
    const vm0 = ev(x0 + hw, y0);
    const v0m = ev(x0, y0 + hh);
    const vmm = ev(x0 + hw, y0 + hh);
    const v1m = ev(x0 + w, y0 + hh);
    const vm1 = ev(x0 + hw, y0 + h);
    cell(x0, y0, hw, hh, v00, vm0, v0m, vmm, level - 1);
    cell(x0 + hw, y0, hw, hh, vm0, v10, vmm, v1m, level - 1);
    cell(x0, y0 + hh, hw, hh, v0m, vmm, v01, vm1, level - 1);
    cell(x0 + hw, y0 + hh, hw, hh, vmm, v1m, vm1, v11, level - 1);
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * (cols + 1) + i;
      cell(vp.xmin + i * dx, vp.ymin + j * dy, dx, dy, grid[k], grid[k + 1], grid[k + cols + 1], grid[k + cols + 2], levels);
    }
  }
  return out;
}

export function opHolds(op: IneqOp, v: number): boolean {
  switch (op) {
    case '<':
      return v < 0;
    case '<=':
      return v <= 0;
    case '>':
      return v > 0;
    case '>=':
      return v >= 0;
  }
}

/** Raster mask of the region where an inequality holds, as runs of cells. */
export function inequalityRegion(item: CompiledItem, vp: Viewport, cellPx = 3): { x: number; y: number; w: number; h: number }[] {
  const cols = Math.ceil(vp.width / cellPx);
  const rows = Math.ceil(vp.height / cellPx);
  const dx = (vp.xmax - vp.xmin) / cols;
  const dy = (vp.ymax - vp.ymin) / rows;
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  const holds = (x: number, y: number): boolean => {
    if (item.restrict && !item.restrict(x, y, 0, 0)) return false;
    if (item.cond) return !!item.cond(x, y);
    if (!item.fn || !item.op) return false;
    if (item.ineqAxis === 'y') return opHolds(item.op, y - item.fn(x));
    if (item.ineqAxis === 'x') return opHolds(item.op, x - item.fn(y));
    return opHolds(item.op, item.fn(x, y));
  };
  for (let j = 0; j < rows; j++) {
    const y = vp.ymin + (j + 0.5) * dy;
    let start = -1;
    for (let i = 0; i <= cols; i++) {
      const inside = i < cols && holds(vp.xmin + (i + 0.5) * dx, y);
      if (inside && start < 0) start = i;
      if (!inside && start >= 0) {
        rects.push({ x: vp.xmin + start * dx, y: vp.ymin + j * dy, w: (i - start) * dx, h: dy });
        start = -1;
      }
    }
  }
  return rects;
}

/** Boundary curve of an inequality (for drawing solid / dashed edges). */
export function inequalityBoundary(item: CompiledItem, vp: Viewport): Polyline[] {
  if (!item.fn) return [];
  if (item.ineqAxis === 'y') return sampleExplicit(item.fn, vp, 'y', item.restrict);
  if (item.ineqAxis === 'x') return sampleExplicit(item.fn, vp, 'x', item.restrict);
  return sampleImplicit(item.fn, vp, item.restrict);
}

/** Sample any compiled item into polylines. */
export function sampleItem(item: CompiledItem, vp: Viewport, angle: 'rad' | 'deg' | 'grad' = 'rad'): Polyline[] {
  const toRad = angle === 'deg' ? Math.PI / 180 : angle === 'grad' ? Math.PI / 200 : 1;
  switch (item.kind) {
    case 'explicit':
      return item.fn ? sampleExplicit(item.fn, vp, 'y', item.restrict) : [];
    case 'explicitX':
      return item.fn ? sampleExplicit(item.fn, vp, 'x', item.restrict) : [];
    case 'polar':
      return item.fn ? samplePolar(item.fn, item.range![0], item.range![1], vp, toRad, item.restrict) : [];
    case 'parametric':
      return item.fx && item.fy ? sampleParametric(item.fx, item.fy, item.range![0], item.range![1], vp, item.restrict) : [];
    case 'implicit':
      return item.fn ? sampleImplicit(item.fn, vp, item.restrict) : [];
    case 'inequality':
      return inequalityBoundary(item, vp);
    default:
      return [];
  }
}
