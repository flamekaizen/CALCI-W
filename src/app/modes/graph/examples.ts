/** Example graphs: the answer to "what can Calci plot?" — used by the gallery and the Guide. */

export interface ExampleExpr {
  text: string;
  range?: [number, number];
  slider?: { min: number; max: number; step: number };
}

export interface GraphExample {
  title: string;
  desc: string;
  exprs: (string | ExampleExpr)[];
  view?: { xmin: number; xmax: number; ymin?: number; ymax?: number };
}

export interface ExampleCategory {
  id: string;
  title: string;
  blurb: string;
  syntax: string;
  items: GraphExample[];
}

const S = (text: string, min: number, max: number, step = 0.1): ExampleExpr => ({ text, slider: { min, max, step } });
const TAU = 2 * Math.PI;

export const GRAPH_EXAMPLES: ExampleCategory[] = [
  {
    id: 'functions',
    title: 'Functions y = f(x)',
    blurb: 'Any formula in x. Start with y = or just type the expression.',
    syntax: 'y = 2x + 1    x^2 - 4x + 3    1/(x - 1)    |x - 2|    sqrt(x)    floor(x)',
    items: [
      { title: 'Line', desc: 'Slope 2, intercept 1', exprs: ['y = 2x + 1'] },
      { title: 'Parabola', desc: 'Roots and vertex are marked when selected', exprs: ['y = x^2 - 4x + 3'], view: { xmin: -3, xmax: 7 } },
      { title: 'Cubic', desc: 'Local max and min', exprs: ['y = x^3 - 3x'], view: { xmin: -4, xmax: 4 } },
      { title: 'Rational function', desc: 'Vertical asymptote at x = 1', exprs: ['y = (x + 2)/(x - 1)'] },
      { title: 'Absolute value', desc: 'Type |x| or abs(x)', exprs: ['y = |x - 2| - 1'] },
      { title: 'Exponential & log', desc: 'Inverse functions mirrored in y = x', exprs: ['y = e^x', 'y = ln(x)', 'y = x'], view: { xmin: -5, xmax: 7 } },
      { title: 'Roots', desc: 'Square and cube roots (real for negative x)', exprs: ['y = sqrt(x)', 'y = cbrt(x)'] },
      { title: 'Step function', desc: 'floor, ceil and round', exprs: ['y = floor(x)'] },
    ],
  },
  {
    id: 'trig',
    title: 'Trigonometry',
    blurb: 'Radians by default — switch to degrees in graph settings. Use π-labels on the x-axis.',
    syntax: 'sin(x)  cos(x)  tan(x)  sec(x)  asin(x)  sinh(x)',
    items: [
      { title: 'Sine & cosine', desc: 'Intersections are found automatically', exprs: ['y = sin(x)', 'y = cos(x)'] },
      { title: 'Tangent', desc: 'Asymptotes are not joined', exprs: ['y = tan(x)'] },
      { title: 'Sinusoid with sliders', desc: 'Amplitude, frequency and phase', exprs: ['y = a sin(b x + c)', S('a = 2', -5, 5), S('b = 1', 0, 5), S('c = 0', -3.14, 3.14)] },
      { title: 'Damped wave', desc: 'Product of exponential and sine', exprs: ['y = e^(-x/5) sin(3x)', 'y = e^(-x/5)', 'y = -e^(-x/5)'], view: { xmin: -1, xmax: 15 } },
    ],
  },
  {
    id: 'sliders',
    title: 'Sliders & animation',
    blurb: 'Any unknown letter offers a slider. Press ▶ to animate it.',
    syntax: 'y = a(x - h)^2 + k   then a = 1, h = 0, k = 0',
    items: [
      { title: 'Vertex form', desc: 'Move and stretch a parabola', exprs: ['y = a(x - h)^2 + k', S('a = 1', -3, 3), S('h = 0', -5, 5), S('k = 0', -5, 5)] },
      { title: 'Family of lines', desc: 'Slope slider', exprs: ['y = m x + 1', S('m = 1', -5, 5)] },
      { title: 'Moving point', desc: 'A point that follows the parabola', exprs: ['y = x^2', '(p, p^2)', S('p = 1', -3, 3, 0.05)] },
    ],
  },
  {
    id: 'implicit',
    title: 'Implicit curves & conics',
    blurb: 'Equations with both x and y — Calci traces them with marching squares.',
    syntax: 'x^2 + y^2 = 25    x^2/9 - y^2/4 = 1    x = y^2    xy = 1',
    items: [
      { title: 'Circle', desc: 'Radius 5', exprs: ['x^2 + y^2 = 25'] },
      { title: 'Ellipse', desc: 'Axes 4 and 2', exprs: ['x^2/16 + y^2/4 = 1'] },
      { title: 'Hyperbola', desc: 'Two branches', exprs: ['x^2/9 - y^2/4 = 1'] },
      { title: 'Sideways parabola', desc: 'x as a function of y', exprs: ['x = y^2 - 3'] },
      { title: 'Folium of Descartes', desc: 'A classic cubic curve', exprs: ['x^3 + y^3 = 3x y'], view: { xmin: -4, xmax: 4 } },
      { title: 'Egg crate', desc: 'Periodic implicit curve', exprs: ['sin(x) = cos(y)'] },
    ],
  },
  {
    id: 'polar',
    title: 'Polar curves',
    blurb: 'Start with r = and use θ (type theta). Adjust the θ range under the expression.',
    syntax: 'r = 3 sin(4θ)    r = 2(1 + cos(θ))    r = θ/2',
    items: [
      { title: 'Rose', desc: '8 petals', exprs: ['r = 3 sin(4θ)'], view: { xmin: -5, xmax: 5 } },
      { title: 'Cardioid', desc: 'Heart-shaped curve', exprs: ['r = 2(1 + cos(θ))'], view: { xmin: -3, xmax: 6 } },
      { title: 'Spiral', desc: 'Archimedean spiral', exprs: [{ text: 'r = θ/2', range: [0, 6 * Math.PI] }] },
      { title: 'Limaçon', desc: 'With an inner loop', exprs: ['r = 1 + 2cos(θ)'], view: { xmin: -3, xmax: 5 } },
      { title: 'Lemniscate', desc: 'Polar equation in r and θ', exprs: ['r^2 = 9 cos(2θ)'], view: { xmin: -5, xmax: 5 } },
    ],
  },
  {
    id: 'parametric',
    title: 'Parametric curves',
    blurb: 'A point (x(t), y(t)). The t-range appears under the expression.',
    syntax: '(cos(t), sin(t))    (sin(3t), sin(2t))    (t - sin(t), 1 - cos(t))',
    items: [
      { title: 'Lissajous figure', desc: 'Frequencies 3 : 2', exprs: ['(3 sin(3t), 3 sin(2t))'], view: { xmin: -5, xmax: 5 } },
      { title: 'Cycloid', desc: 'Path of a point on a rolling wheel', exprs: [{ text: '(t - sin(t), 1 - cos(t))', range: [0, 4 * Math.PI] }], view: { xmin: -1, xmax: 14 } },
      { title: 'Butterfly curve', desc: 'Temple Fay’s butterfly', exprs: [{ text: '(sin(t)(e^cos(t) - 2cos(4t) - sin(t/12)^5), cos(t)(e^cos(t) - 2cos(4t) - sin(t/12)^5))', range: [0, 12 * Math.PI] }], view: { xmin: -5, xmax: 5 } },
      { title: 'Heart', desc: 'Parametric heart', exprs: ['(16 sin(t)^3 / 4, (13cos(t) - 5cos(2t) - 2cos(3t) - cos(4t)) / 4)'], view: { xmin: -6, xmax: 6 } },
    ],
  },
  {
    id: 'inequalities',
    title: 'Inequalities & regions',
    blurb: 'Use < > ≤ ≥ to shade. Strict inequalities draw a dashed edge.',
    syntax: 'y < x^2    x^2 + y^2 <= 9    |x| + |y| < 3    -1 < y < sin(x)',
    items: [
      { title: 'Below a parabola', desc: 'Dashed boundary (strict)', exprs: ['y < x^2 - 2'] },
      { title: 'Disc', desc: 'Inside a circle, edge included', exprs: ['x^2 + y^2 <= 9'] },
      { title: 'Diamond', desc: 'Absolute values', exprs: ['|x| + |y| < 3'] },
      { title: 'Between curves', desc: 'Chained inequality', exprs: ['-1 < y < sin(x)'] },
      { title: 'Feasible region', desc: 'Linear programming', exprs: ['y <= -x + 6', 'y >= x/2', 'x >= 0'], view: { xmin: -2, xmax: 8 } },
    ],
  },
  {
    id: 'piecewise',
    title: 'Piecewise & restrictions',
    blurb: 'Braces restrict a curve or build a piecewise function.',
    syntax: 'y = x^2 {-2 < x < 2}    y = {x < 0: -x, x^2}',
    items: [
      { title: 'Restricted domain', desc: 'Only between -2 and 2', exprs: ['y = x^2 {-2 < x < 2}'] },
      { title: 'Piecewise', desc: 'Different rules either side of 0', exprs: ['y = {x < 0: -x, x < 2: x^2, 4}'] },
      { title: 'Sawtooth', desc: 'mod creates repetition', exprs: ['y = mod(x, 2)'] },
    ],
  },
  {
    id: 'calculus',
    title: 'Calculus in graphs',
    blurb: "Define f(x), then plot f'(x), f''(x), integrals, sums and tangents.",
    syntax: "f(x) = …   y = f'(x)   y = integral(f(t), t, 0, x)   y = sigma(x^n/n!, n, 0, 8)",
    items: [
      { title: 'Function & derivatives', desc: "f, f' and f''", exprs: ['f(x) = x^3 - 3x', 'y = f(x)', "y = f'(x)", "y = f''(x)"], view: { xmin: -4, xmax: 4 } },
      { title: 'Tangent line', desc: 'Drag a to move the tangent', exprs: ['f(x) = sin(x) + x/2', 'y = f(x)', "y = f'(a)*(x - a) + f(a)", S('a = 1', -6, 6)] },
      { title: 'Area function', desc: 'The integral as a function of x', exprs: ['y = sin(x)', 'y = integral(sin(t), t, 0, x)'] },
      { title: 'Taylor polynomials', desc: 'More terms hug eˣ longer', exprs: ['y = e^x', 'y = sigma(x^k / k!, k, 0, n)', S('n = 3', 0, 12, 1)], view: { xmin: -6, xmax: 4 } },
      { title: 'Area under a curve', desc: 'Shade with an inequality and a restriction', exprs: ['y = x^2', '0 < y < x^2 {0 < x < 2}'], view: { xmin: -1, xmax: 3 } },
    ],
  },
  {
    id: 'points',
    title: 'Points & data',
    blurb: 'Write points as (x, y), separated by commas. Regression results can be sent here from Statistics.',
    syntax: '(1, 2), (3, 4), (5, 3)',
    items: [
      { title: 'Data points', desc: 'Several points in one line', exprs: ['(1, 2), (2, 3.5), (3, 3), (4, 5), (5, 6.2)'], view: { xmin: -1, xmax: 7 } },
      { title: 'Points with a fit line', desc: 'Compare data and a model', exprs: ['(1, 2), (2, 3.5), (3, 3), (4, 5), (5, 6.2)', 'y = 0.98x + 1.06'], view: { xmin: -1, xmax: 7 } },
    ],
  },
  {
    id: 'stats',
    title: 'Probability curves',
    blurb: 'Distribution functions work in graphs too.',
    syntax: 'normalpdf(x, μ, σ)   tpdf(x, df)   chi2pdf(x, k)',
    items: [
      { title: 'Normal curve', desc: 'Slide the mean and spread', exprs: ['y = normalpdf(x, m, s)', S('m = 0', -3, 3), S('s = 1', 0.2, 3)], view: { xmin: -5, xmax: 5, ymin: -0.2, ymax: 1 } },
      { title: 't vs normal', desc: 'Heavier tails for small df', exprs: ['y = normalpdf(x)', 'y = tpdf(x, 2)'], view: { xmin: -5, xmax: 5, ymin: -0.1, ymax: 0.5 } },
    ],
  },
];

export const EXAMPLE_COUNT = GRAPH_EXAMPLES.reduce((n, c) => n + c.items.length, 0);
export const TAU_RANGE: [number, number] = [0, TAU];
