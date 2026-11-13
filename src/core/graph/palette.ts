/**
 * Curve colours: 8 hues spaced for distinguishability (including common
 * colour-vision deficiencies), with lighter variants for dark backgrounds.
 */
export const CURVE_COLORS_LIGHT = ['#4F46E5', '#E11D48', '#059669', '#D97706', '#0284C7', '#9333EA', '#0D9488', '#475569'];
export const CURVE_COLORS_DARK = ['#8B8CFB', '#FB7185', '#34D399', '#FBBF24', '#38BDF8', '#C084FC', '#2DD4BF', '#A3AEC2'];

export function curveColor(i: number, dark = false): string {
  const p = dark ? CURVE_COLORS_DARK : CURVE_COLORS_LIGHT;
  return p[((i % p.length) + p.length) % p.length];
}

/** Map a stored light-palette colour to its dark-mode partner (custom colours pass through). */
export function adaptColor(color: string, dark: boolean): string {
  const i = CURVE_COLORS_LIGHT.indexOf(color.toUpperCase());
  if (i < 0) return color;
  return dark ? CURVE_COLORS_DARK[i] : CURVE_COLORS_LIGHT[i];
}

/** Perceptually ordered colormap for surfaces / heatmaps (t in [0, 1]). */
export function colormap(t: number): [number, number, number] {
  const stops: [number, number, number][] = [
    [49, 46, 129],
    [67, 97, 238],
    [20, 160, 180],
    [80, 200, 120],
    [235, 210, 70],
    [245, 140, 60],
  ];
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
