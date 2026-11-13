import { describe, it, expect } from 'vitest';
import { Calculator, evaluate, exactForm, formatNumber, programmer, solver, calculus, stats, finance, units, graph, distributions } from '../src/core/index';

const num = (s: string, settings = {}) => Number(evaluate(s, settings).value);

describe('scientific evaluation', () => {
  it('handles basic arithmetic and precedence', () => {
    expect(num('2+3*4')).toBe(14);
    expect(num('2^3^2')).toBe(512);
    expect(evaluate('0.1+0.2').text).toBe('0.3');
  });
  it('uses calculator log conventions', () => {
    expect(num('log(1000)')).toBeCloseTo(3, 12);
    expect(num('ln(e^2)')).toBeCloseTo(2, 12);
    expect(num('log(8, 2)')).toBeCloseTo(3, 12);
    expect(num('log_2(32)')).toBeCloseTo(5, 12);
  });
  it('respects angle modes with exact quarter turns', () => {
    expect(num('sin(30)', { angle: 'deg' })).toBeCloseTo(0.5, 14);
    expect(num('cos(90)', { angle: 'deg' })).toBe(0);
    expect(num('sin(pi)')).toBe(0);
    expect(num('asin(1)', { angle: 'deg' })).toBeCloseTo(90, 12);
    expect(evaluate('tan(90)', { angle: 'deg' }).text).toBe('undefined');
  });
  it('understands friendly notation', () => {
    expect(num('√16 + |−3|')).toBe(7);
    expect(num('2π')).toBeCloseTo(2 * Math.PI, 12);
    expect(num('3²')).toBe(9);
    expect(num('5!')).toBe(120);
    expect(num('nCr(5,2)')).toBe(10);
    expect(num('sin 30', { angle: 'deg' })).toBeCloseTo(0.5, 12);
    expect(num('50%')).toBe(0.5);
  });
  it('keeps state: variables, ans, functions, memory', () => {
    const c = new Calculator();
    c.evaluate('a = 4');
    c.evaluate('f(x) = x^2 + a');
    expect(Number(c.evaluate('f(3)').value)).toBe(13);
    expect(Number(c.evaluate('ans * 2').value)).toBe(26);
    c.memoryAdd();
    expect(Number(c.memoryRecall())).toBe(26);
    expect(c.preview('a = 100')?.text).toBe('100');
    expect(Number(c.evaluate('a').value)).toBe(4);
  });
  it('supports complex numbers, matrices and units', () => {
    expect(evaluate('sqrt(-4)').text).toBe('2i');
    expect(evaluate('det([1,2;3,4])').text).toBe('-2');
    expect(evaluate('5 km to mi').text).toMatch(/^3\.106855961/);
  });
  it('evaluates in-expression calculus', () => {
    expect(num('integral(x^2, x, 0, 3)')).toBeCloseTo(9, 10);
    expect(num('integral(e^(-x^2), x, -Infinity, Infinity)')).toBeCloseTo(Math.sqrt(Math.PI), 9);
    expect(num('diff(sin(x), x, 0)')).toBeCloseTo(1, 9);
    expect(num('sigma(1/n^2, n, 1, Infinity)')).toBeCloseTo(Math.PI ** 2 / 6, 6);
    expect(num('limit(sin(x)/x, x, 0)')).toBeCloseTo(1, 9);
    expect(num('nsolve(x^2 - 2, x, 1)')).toBeCloseTo(Math.SQRT2, 12);
  });
  it('supports arbitrary precision', () => {
    const r = evaluate('1/3', { bignumber: true, precision: 40, digits: 30 });
    expect(r.text).toBe('0.333333333333333333333333333333');
  });
  it('reports friendly errors', () => {
    expect(evaluate('2 + foo').error).toBe('Unknown variable “foo”');
    expect(evaluate('(2+3').ok).toBe(false);
  });
  it('blocks unsafe functions in safe mode', () => {
    expect(evaluate('import({}, {})', { safe: true }).ok).toBe(false);
    expect(evaluate('evaluate("1+1")', { safe: true }).ok).toBe(false);
    expect(evaluate('zeros(100000, 100000)', { safe: true }).ok).toBe(false);
  });
});

describe('formatting and exact forms', () => {
  it('formats notations', () => {
    expect(formatNumber(1234.5678, { notation: 'fix', digits: 2, grouping: true }).text).toBe('1,234.57');
    expect(formatNumber(12345, { notation: 'sci', digits: 3, grouping: false }).text).toBe('1.23E4');
    expect(formatNumber(12345, { notation: 'eng', digits: 4, grouping: false }).text).toBe('12.35E3');
  });
  it('recognises exact forms', () => {
    expect(exactForm(0.75)?.text).toBe('3/4');
    expect(exactForm(Math.SQRT2 / 2)?.text).toBe('√2/2');
    expect(exactForm(Math.PI / 3)?.text).toBe('π/3');
    expect(exactForm((1 + Math.sqrt(5)) / 2)?.text).toBe('(1 + √5)/2');
  });
});

describe('programmer', () => {
  const s = { base: 16 as const, word: 32 as const, signed: true };
  it('evaluates bitwise expressions', () => {
    expect(programmer.progEvaluate('FF AND 0F', s)).toBe(15n);
    expect(programmer.progEvaluate('1 << 4 | 1', { ...s, base: 10 })).toBe(17n);
    expect(programmer.progEvaluate('0b1010 XOR 0x0F', s)).toBe(5n);
    expect(programmer.progEvaluate('7FFFFFFF + 1', s)).toBe(-2147483648n);
    expect(programmer.progEvaluate('80000000 ROL 1', { ...s, signed: false })).toBe(1n);
  });
  it('formats two-complement values', () => {
    expect(programmer.toBase(-1n, 16, 16)).toBe('FFFF');
    expect(programmer.toBase(5n, 2, 8, { pad: true })).toBe('00000101');
  });
  it('inspects IEEE-754', () => {
    expect(programmer.floatBits(1, 32).hex).toBe('3F800000');
    expect(programmer.floatBits(-2, 64).hex).toBe('C000000000000000');
  });
});

describe('solver', () => {
  it('finds polynomial roots', () => {
    const r = solver.polyRoots([1, -6, 11, -6]).map((z) => z.re);
    expect(r).toEqual([1, 2, 3]);
    const c = solver.polyRoots([1, 0, 1]);
    expect(c.map((z) => z.im).sort()).toEqual([-1, 1]);
    const p5 = solver.polyRoots([1, 0, 0, 0, 0, -32]);
    expect(p5.filter((z) => z.im === 0).map((z) => z.re)).toEqual([2]);
  });
  it('classifies linear systems', () => {
    expect(solver.solveLinear([[2, 1], [1, 3]], [3, 5])).toEqual({ kind: 'unique', x: [0.8, 1.4] });
    expect(solver.solveLinear([[1, 1], [2, 2]], [1, 3]).kind).toBe('none');
    expect(solver.solveLinear([[1, 1], [2, 2]], [1, 2]).kind).toBe('infinite');
  });
});

describe('calculus', () => {
  it('differentiates symbolically', () => {
    expect(calculus.differentiate('x^3').text).toBe('3 * x ^ 2');
    expect(calculus.differentiate('ln(x)').text).toBe('1 / x');
    const d = calculus.differentiate('log(x)');
    expect(Number(evaluate(d.text.replace(/x/g, '(10)')).value)).toBeCloseTo(1 / (10 * Math.LN10), 12);
  });
  it('builds Taylor polynomials', () => {
    expect(calculus.taylor('e^x', 'x', 0, 3).coefficients).toEqual([1, 1, 0.5, 1 / 6].map((v) => Number(v.toPrecision(12))));
    expect(calculus.taylor('sin(x)', 'x', 0, 5).text).toBe('x - 1/6*x^3 + 1/120*x^5');
  });
  it('computes limits', () => {
    expect(calculus.limitOf('(1+1/x)^x', Infinity).value).toBeCloseTo(Math.E, 5);
    expect(calculus.limitOf('1/x', 0).exists).toBe(false);
  });
});

describe('statistics', () => {
  it('describes data', () => {
    const d = stats.describe([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(d.mean).toBe(5);
    expect(d.sdPop).toBe(2);
    expect(d.median).toBe(4.5);
    expect(d.modes).toEqual([4]);
  });
  it('fits regressions', () => {
    const lin = stats.regress([1, 2, 3, 4], [3, 5, 7, 9], 'linear');
    expect(lin.params).toEqual({ a: 2, b: 1 });
    expect(lin.r2).toBe(1);
    const ex = stats.regress([0, 1, 2, 3], [2, 6, 18, 54], 'exponential');
    expect(ex.params.a).toBeCloseTo(2, 9);
    expect(ex.params.b).toBeCloseTo(3, 9);
  });
  it('matches distribution reference values', () => {
    expect(distributions.normCdf(1.96)).toBeCloseTo(0.9750021048517795, 12);
    expect(distributions.normInv(0.975)).toBeCloseTo(1.959963984540054, 10);
    expect(distributions.tCdf(2.228, 10)).toBeCloseTo(0.975, 4);
    expect(distributions.chi2Cdf(3.841, 1)).toBeCloseTo(0.95, 4);
    expect(distributions.binomPmf(3, 10, 0.5)).toBeCloseTo(0.1171875, 12);
    expect(distributions.poissonCdf(2, 3)).toBeCloseTo(0.42319008112684353, 10);
  });
  it('runs hypothesis tests', () => {
    const t = stats.tTest(5.5, 1, 25, 5);
    expect(t.statistic).toBeCloseTo(2.5, 12);
    expect(t.p).toBeCloseTo(0.01965, 4);
  });
});

describe('finance', () => {
  it('solves TVM', () => {
    const pmt = finance.solveTvm({ ...finance.DEFAULT_TVM, pmt: 0 }, 'pmt');
    expect(pmt).toBeCloseTo(-1199.1010503, 5);
    const iy = finance.solveTvm({ ...finance.DEFAULT_TVM, pmt: pmt }, 'iy');
    expect(iy).toBeCloseTo(6, 8);
    const n = finance.solveTvm({ ...finance.DEFAULT_TVM, pmt: pmt }, 'n');
    expect(n).toBeCloseTo(360, 8);
  });
  it('computes NPV and IRR', () => {
    expect(finance.npv(10, [-1000, 500, 500, 500])).toBeCloseTo(243.4259954921112, 8);
    expect(finance.irr([-1000, 500, 500, 500])).toBeCloseTo(23.37519285, 6);
  });
  it('builds an amortisation schedule that ends at zero', () => {
    const rows = finance.amortization({ ...finance.DEFAULT_TVM, n: 12, iy: 12, pv: 1000, pmt: 0 });
    expect(Math.abs(rows[rows.length - 1].balance)).toBeLessThan(1e-6);
  });
});

describe('units', () => {
  it('converts', () => {
    expect(units.convertUnit(100, 'degC', 'degF')).toBeCloseTo(212, 10);
    expect(units.convertUnit(1, 'mi', 'km')).toBeCloseTo(1.609344, 10);
    expect(units.convertUnit(1, 'GiB', 'MB')).toBeCloseTo(1073.741824, 8);
    expect(units.convertUnit(30, 'mpg(US)', 'L/100km')).toBeCloseTo(7.84049, 4);
  });
});

describe('graph', () => {
  const vp = { xmin: -10, xmax: 10, ymin: -7, ymax: 7, width: 800, height: 560 };
  it('classifies expression lines', () => {
    const g = graph.compileGraph([
      { id: '1', text: 'y = a x^2' },
      { id: '2', text: 'a = 2' },
      { id: '3', text: 'x^2 + y^2 = 25' },
      { id: '4', text: 'r = 1 + cos(θ)' },
      { id: '5', text: '(cos(t), sin(t))' },
      { id: '6', text: '(1, 2), (3, 4)' },
      { id: '7', text: 'y < x' },
      { id: '8', text: 'f(x) = sin(x)' },
      { id: '9', text: 'f(x) + b' },
      { id: '10', text: 'x = y^2' },
      { id: '11', text: 'y = x^2 {0 < x < 2}' },
      { id: '12', text: 'y = {x < 0: -x, x}' },
      { id: '13', text: 'xy = 1' },
    ]);
    expect(g.items.map((i) => i.kind)).toEqual(['explicit', 'variable', 'implicit', 'polar', 'parametric', 'points', 'inequality', 'function', 'error', 'explicitX', 'explicit', 'explicit', 'implicit']);
    expect(g.items[0].fn!(3)).toBe(18);
    expect(g.items[8].missing).toEqual(['b']);
    expect(g.items[10].restrict!(3, 9, 0, 0)).toBe(0);
    expect(g.items[11].fn!(-4)).toBe(4);
  });
  it('samples curves and breaks at asymptotes', () => {
    const g = graph.compileGraph([{ id: '1', text: 'y = tan(x)' }]);
    const segs = graph.sampleItem(g.items[0], vp);
    expect(segs.length).toBeGreaterThanOrEqual(6);
    const circle = graph.compileGraph([{ id: 'c', text: 'x^2 + y^2 = 9' }]);
    const pts = graph.sampleItem(circle.items[0], vp);
    for (const s of pts) expect(Math.abs(Math.hypot(s[0], s[1]) - 3)).toBeLessThan(0.02);
  });
  it('finds points of interest', () => {
    const g = graph.compileGraph([{ id: '1', text: 'y = x^2 - 4' }, { id: '2', text: 'y = x' }]);
    const p = graph.pointsOfInterest(g.items, -10, 10);
    expect(p.filter((q) => q.kind === 'root').map((q) => q.x)).toEqual([-2, 2, 0]);
    expect(p.find((q) => q.kind === 'min')).toMatchObject({ x: 0, y: -4 });
    expect(p.filter((q) => q.kind === 'intersection').length).toBe(2);
  });
  it('renders SVG', () => {
    const svg = graph.renderSvg(['y = sin(x)', 'y < x/2'], { width: 400, height: 300 });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('stroke="#4F46E5"');
  });
});
