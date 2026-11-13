/** Axis tick computation shared by the canvas and SVG renderers. */

/** A "nice" step (1, 2, 5 x 10^n) giving roughly `targetPx` pixels between ticks. */
export function niceStep(range: number, pixels: number, targetPx = 90): number {
  const raw = (range / pixels) * targetPx;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  const nice = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10;
  return nice * p;
}

/** The minor subdivision count that goes with a major step. */
export function minorDivisions(step: number): number {
  const m = step / Math.pow(10, Math.floor(Math.log10(step)));
  return Math.round(m) === 2 ? 4 : 5;
}

export function ticks(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start, i = 0; v <= max + step * 1e-9 && i < 2000; v = start + ++i * step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

/** Tick label without floating noise; optional multiples of pi. */
export function tickLabel(v: number, step: number, piMode = false): string {
  if (piMode) {
    const k = Math.round((v / Math.PI) * 12);
    if (Math.abs(k / 12 - v / Math.PI) < 1e-9) {
      if (k === 0) return '0';
      const g = gcd(Math.abs(k), 12);
      const num = k / g;
      const den = 12 / g;
      const n = num === 1 ? '' : num === -1 ? '-' : String(num);
      return den === 1 ? `${n}π` : `${n}π/${den}`;
    }
  }
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1e6 || abs < 1e-4) {
    const e = Math.floor(Math.log10(abs));
    const m = v / Math.pow(10, e);
    const ms = Number(m.toPrecision(3)).toString();
    return `${ms === '1' ? '' : ms === '-1' ? '-' : `${ms}×`}10${superscript(e)}`;
  }
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return Number(v.toFixed(Math.min(decimals + 1, 12))).toString().replace('-', '−');
}

/** Step that is a nice fraction of pi, for trig-friendly axes. */
export function piStep(range: number, pixels: number, targetPx = 90): number {
  const raw = (range / pixels) * targetPx;
  const candidates = [1 / 12, 1 / 6, 1 / 4, 1 / 3, 1 / 2, 1, 2, 4, 5, 10, 20, 50, 100].map((k) => k * Math.PI);
  return candidates.find((c) => c >= raw) ?? candidates[candidates.length - 1];
}

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
function superscript(n: number): string {
  return String(n).split('').map((c) => SUP[c] ?? c).join('');
}
function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}
