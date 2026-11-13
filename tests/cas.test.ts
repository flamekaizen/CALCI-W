import { describe, it, expect } from 'vitest';
import { antiderivative, factorPolynomial, solveInequality } from '../src/core/cas';
import { createMath } from '../src/core/math';
import { prepare } from '../src/core/engine';

/* ----------------------------------- helpers ----------------------------------- */

const calc = createMath();

/** Evaluate an expression string with calculator semantics (ln = natural, log = log10). */
function fnOf(expr: string, v = 'x') {
  const code = calc.parse(prepare(expr)).compile();
  return (x: number) => {
    try {
      const r = code.evaluate({ [v]: x });
      return typeof r === 'number' ? r : NaN;
    } catch {
      return NaN;
    }
  };
}

const POINTS = [-2.7, -1.9, -1.3, -0.77, -0.35, 0.21, 0.46, 0.83, 1.27, 1.74, 2.38, 3.1];

/** d/dx F ≈ f at every sample point where both are real; returns how many points were checked. */
function checkDerivative(integrand: string, v = 'x'): number {
  const r = antiderivative(integrand, v);
  expect(r, `no antiderivative for ${integrand}`).not.toBeNull();
  const F = fnOf(r!.text, v);
  const f = fnOf(integrand, v);
  let checked = 0;
  for (const x of POINTS) {
    const y = f(x);
    if (!Number.isFinite(y) || Math.abs(y) > 1e6) continue;
    const h = 1e-4;
    const vals = [F(x - 2 * h), F(x - h), F(x + h), F(x + 2 * h)];
    if (!vals.every(Number.isFinite)) continue;
    const d = (vals[0] - 8 * vals[1] + 8 * vals[2] - vals[3]) / (12 * h);
    expect(Math.abs(d - y), `${integrand} → ${r!.text} at ${v}=${x}`).toBeLessThan(1e-6 * Math.max(1, Math.abs(y)));
    checked++;
  }
  return checked;
}

/* ---------------------------------- integration ---------------------------------- */

describe('antiderivative: numeric derivative checks', () => {
  const families: Record<string, string[]> = {
    'power rule': ['7', 'x', 'x^3', 'x^-2', 'x^(-3)', 'x^(1/2)', 'x^(-1/2)', '√x', 'x^(2/3)', 'pi*x'],
    'reciprocal / logs': ['1/x', 'x^(-1)', '3/x', '1/(2x+3)', '1/(1-x)', 'ln(x)', 'log(x)', 'ln(2x+1)', 'log10(x)'],
    'sums and constants': ['3x^2 + 2x + 1', 'x^2/3 - 4', '5x^4 - 3x + 2/x', '(x+1)(x-1)', '2*sin(x) - 3*cos(x)', '-e^x/4'],
    exponentials: ['e^x', 'e^(3x+1)', 'e^(-x)', 'exp(2x)', '2^x', '2^(3x)', '10^(x/2)'],
    'trig of linear arguments': ['sin(2x+1)', 'cos(3x)', 'tan(x)', 'sec(x)^2', 'csc(x)^2', 'sec(x)*tan(x)', 'csc(x)*cot(x)', 'sec(x)', 'csc(x)', 'cot(2x)', 'sin(x/2 - 1)', '1/cos(x)^2'],
    'trig powers': ['sin(x)^2', 'cos(2x)^2', 'tan(x)^2', 'sin(x)^3', 'cos(x)^4'],
    'inverse trig forms': ['1/(1+x^2)', '1/sqrt(1-x^2)', '1/(4+x^2)', '1/sqrt(4-x^2)', '1/(x^2+2x+5)', '1/sqrt(x^2+1)', 'atan(x)', 'asin(x)', 'acos(x)'],
    hyperbolic: ['sinh(x)', 'cosh(2x)', 'tanh(x)', 'x*sinh(x)'],
    'linear substitution': ['(2x+1)^5', '(3x-2)^(-2)', 'sqrt(2x+1)', '(1-x)^(1/2)', '(4x+1)^(-1/2)'],
    'integration by parts (tabular)': ['x*e^x', 'x^2*e^(2x)', 'x^3*e^(-x)', 'x*sin(x)', 'x^2*cos(3x)', '(x^2+1)*sin(2x+1)', 'x*3^x', 'x*ln(x)', 'x^2*ln(x)'],
    'products of exp and trig': ['e^x*sin(x)', 'e^(2x)*cos(3x)', 'sin(3x)*cos(2x)', 'sin(x)*sin(2x)'],
    'u-substitution': ['x*e^(x^2)', 'sin(x)*cos(x)', 'ln(x)/x', 'x*cos(x^2)', 'cos(x)*e^(sin(x))', 'x/sqrt(x^2+1)', 'sin(x)^3*cos(x)'],
    'rational functions': ['2x/(x^2+1)', '1/(x^2-1)', '(x^2+1)/(x+1)', 'x^3/(x^2+1)', '1/(x-1)^2', 'x/(x-1)^2', '1/(x^2+x+1)', '1/(x^3+1)', '1/(x*(x+1)*(x+2))', '(x+1)/(x^2*(x-1))'],
    'misc': ['abs(x)', '|x|'],
  };
  for (const [family, list] of Object.entries(families)) {
    it(family, () => {
      for (const f of list) expect(checkDerivative(f), `too few valid points for ${f}`).toBeGreaterThanOrEqual(3);
    });
  }
});

describe('antiderivative: exact forms', () => {
  const text = (s: string, v = 'x') => antiderivative(s, v)?.text;
  it('uses ln for natural log and never appends + C', () => {
    expect(text('1/x')).toBe('ln(abs(x))');
    expect(text('x^(-1)')).toBe('ln(abs(x))');
    expect(text('ln(x)')).toBe('x * ln(x) - x');
    expect(text('log(x)')).toContain('ln(10)');
    for (const s of ['x^2', 'sin(x)', 'e^x', '1/x']) expect(text(s)).not.toMatch(/\+\s*C/);
  });
  it('produces textbook results', () => {
    expect(text('x^3')).toBe('x ^ 4 / 4');
    expect(text('3x^2 + 2x + 1')).toBe('x ^ 3 + x ^ 2 + x');
    expect(text('5')).toBe('5 * x');
    expect(text('e^x')).toBe('e ^ x');
    expect(text('sin(2x+1)')).toBe('-cos(2 x + 1) / 2');
    expect(text('cos(3x)')).toBe('sin(3 x) / 3');
    expect(text('sec(x)^2')).toBe('tan(x)');
    expect(text('csc(x)^2')).toBe('-cot(x)');
    expect(text('sec(x)*tan(x)')).toBe('sec(x)');
    expect(text('1/(1+x^2)')).toBe('atan(x)');
    expect(text('1/sqrt(1-x^2)')).toBe('asin(x)');
    expect(text('sinh(x)')).toBe('cosh(x)');
    expect(text('1/(2x+3)')).toBe('ln(abs(2 x + 3)) / 2');
    expect(text('(2x+1)^5')).toBe('(2 x + 1) ^ 6 / 12');
    expect(text('x*e^x')).toBe('e ^ x * (x - 1)');
    expect(text('2^x')).toBe('2 ^ x / ln(2)');
    expect(text('x*e^(x^2)')).toBe('e ^ x ^ 2 / 2');
  });
  it('produces TeX with calculator conventions', () => {
    const r = antiderivative('1/x')!;
    expect(r.tex).toContain('\\ln');
    expect(r.tex).toContain('\\left|');
    expect(antiderivative('1/(1+x^2)')!.tex).toContain('\\tan^{-1}');
    expect(antiderivative('x^3')!.tex).toContain('\\frac');
  });
  it('supports other variables and symbolic constants', () => {
    expect(text('t^2', 't')).toBe('t ^ 3 / 3');
    expect(checkDerivative('sin(3t)', 't')).toBeGreaterThanOrEqual(3);
    expect(text('a*x')).toBe('a * x ^ 2 / 2');
    expect(text('x^2 + 3', 'y')).toBe('(x ^ 2 + 3) * y');
  });
  it('returns null when no rule applies or the input is invalid', () => {
    for (const s of ['e^(x^2)', 'sin(x^2)', 'x^x', 'sin(x)/x', '', 'sin(', 'ln(x)^2']) expect(antiderivative(s), s).toBeNull();
  });
});

/* ----------------------------------- factoring ----------------------------------- */

describe('factorPolynomial', () => {
  const f = (s: string) => factorPolynomial(s);
  it('factors the documented examples', () => {
    expect(f('x^2-5x+6')!.text).toBe('(x - 2)(x - 3)');
    expect(f('2x^3-2x')!.text).toBe('2x(x - 1)(x + 1)');
    expect(f('x^2+1')!.text).toBe('x^2 + 1');
    expect(f('6x^2+x-2')!.text).toBe('(2x - 1)(3x + 2)');
    expect(f('x^4-1')!.text).toBe('(x - 1)(x + 1)(x^2 + 1)');
  });
  it('lists factors individually', () => {
    expect(f('2x^3-2x')!.factors).toEqual(['2', 'x', 'x - 1', 'x + 1']);
    expect(f('x^4-1')!.factors).toEqual(['x - 1', 'x + 1', 'x^2 + 1']);
    expect(f('3x^2-6x+3')!.factors).toEqual(['3', '(x - 1)^2']);
  });
  it('handles multiplicity, content, signs and rational coefficients', () => {
    expect(f('x^2-2x+1')!.text).toBe('(x - 1)^2');
    expect(f('4x^2-4x+1')!.text).toBe('(2x - 1)^2');
    expect(f('x^3-3x^2+3x-1')!.text).toBe('(x - 1)^3');
    expect(f('(x-1)^3(x+2)')!.text).toBe('(x - 1)^3(x + 2)');
    expect(f('x^3')!.text).toBe('x^3');
    expect(f('x^2+x')!.text).toBe('x(x + 1)');
    expect(f('2x+4')!.text).toBe('2(x + 2)');
    expect(f('12x^2-12')!.text).toBe('12(x - 1)(x + 1)');
    expect(f('-x^2+1')!.text).toBe('-(x - 1)(x + 1)');
    expect(f('x^2/2-1/8')!.text).toBe('(1/8)(2x - 1)(2x + 1)');
    expect(f('0.5x^2 - 0.5')!.text).toBe('(1/2)(x - 1)(x + 1)');
    expect(f('x^5-x')!.text).toBe('x(x - 1)(x + 1)(x^2 + 1)');
  });
  it('leaves irreducible parts alone', () => {
    expect(f('x^2-2')!.text).toBe('x^2 - 2');
    expect(f('x^3+x+1')!.text).toBe('x^3 + x + 1');
    expect(f('x^6-1')!.text).toBe('(x - 1)(x + 1)(x^4 + x^2 + 1)');
  });
  it('produces TeX', () => {
    expect(f('x^4-1')!.tex).toBe('\\left(x - 1\\right)\\left(x + 1\\right)\\left(x^{2} + 1\\right)');
    expect(f('x^2/2-1/8')!.tex).toBe('\\frac{1}{8}\\left(2x - 1\\right)\\left(2x + 1\\right)');
  });
  it('supports other variables', () => {
    expect(factorPolynomial('t^2-9', 't')!.text).toBe('(t - 3)(t + 3)');
  });
  it('returns null for non-polynomials, constants and irrational coefficients', () => {
    for (const s of ['sin(x)', '1/x', '5', 'pi*x^2-1', 'x^(1/2)', '']) expect(f(s), s).toBeNull();
  });
  it('factors agree numerically with the input', () => {
    for (const s of ['x^2-5x+6', '6x^2+x-2', '2x^3-2x', 'x^4-1', 'x^2/2-1/8', '(x-1)^3(x+2)', '-3x^3+12x']) {
      const r = f(s)!;
      const product = r.factors.map((p) => `(${p})`).join('*');
      const a = fnOf(s);
      const b = fnOf(product);
      for (const x of [-2.5, -0.4, 0.7, 1.9]) expect(b(x)).toBeCloseTo(a(x), 9);
    }
  });
});

/* ---------------------------------- inequalities ---------------------------------- */

describe('solveInequality', () => {
  const s = (e: string) => solveInequality(e);
  it('solves the documented examples', () => {
    const a = s('x^2 - 3x + 2 > 0');
    expect(a.text).toBe('x < 1 or x > 2');
    expect(a.intervals).toEqual([
      [-Infinity, 1, false, false],
      [2, Infinity, false, false],
    ]);
    const b = s('x^2 + 1 < 0');
    expect(b.none).toBe(true);
    expect(b.intervals).toEqual([]);
    expect(b.text).toBe('no solution');
    const c = s('(x-1)^2 >= 0');
    expect(c.all).toBe(true);
    expect(c.intervals).toEqual([[-Infinity, Infinity, false, false]]);
    expect(c.text).toBe('all real x');
  });
  it('handles closed endpoints and unicode operators', () => {
    expect(s('x^2 - 3x + 2 <= 0').intervals).toEqual([[1, 2, true, true]]);
    expect(s('x^2 - 3x + 2 ≤ 0').text).toBe('1 ≤ x ≤ 2');
    expect(s('x^2 ≥ 4').text).toBe('x ≤ -2 or x ≥ 2');
    expect(s('3x - 1 > 0').text).toBe('x > 1/3');
    expect(s('3x - 1 > 0').tex).toBe('x > \\frac{1}{3}');
  });
  it('shows exact irrational endpoints', () => {
    const r = s('x^2 - 2 <= 0');
    expect(r.text).toBe('-√2 ≤ x ≤ √2');
    expect(r.tex).toBe('-\\sqrt{2} \\le x \\le \\sqrt{2}');
    expect(r.intervals[0][0]).toBeCloseTo(-Math.SQRT2, 12);
    expect(s('x^2 - x - 1 > 0').text).toBe('x < (1 - √5)/2 or x > (1 + √5)/2');
  });
  it('handles touching roots and isolated points', () => {
    expect(s('x^2 > 0').text).toBe('x ≠ 0');
    expect(s('(x-1)^2 <= 0').intervals).toEqual([[1, 1, true, true]]);
    expect(s('(x-1)^2 <= 0').text).toBe('x = 1');
    expect(s('(x-1)^2 < 0').none).toBe(true);
    expect(s('(x^2-2)^2 > 0').text).toBe('x ≠ -√2 and x ≠ √2');
  });
  it('solves higher-degree polynomials', () => {
    expect(s('x^3 - x < 0').text).toBe('x < -1 or 0 < x < 1');
    expect(s('x^4 - 5x^2 + 4 <= 0').text).toBe('-2 ≤ x ≤ -1 or 1 ≤ x ≤ 2');
    expect(s('x^2 + x + 1 > 0').all).toBe(true);
    expect(s('x^3 > 2').intervals[0][0]).toBeCloseTo(Math.cbrt(2), 10);
  });
  it('solves rational inequalities, excluding poles', () => {
    expect(s('(x-1)/(x+2) >= 0').text).toBe('x < -2 or x ≥ 1');
    expect(s('1/x > 0').text).toBe('x > 0');
    expect(s('x + 1/x >= 2').text).toBe('x > 0');
    expect(s('x + 1/x >= 2').intervals).toEqual([[0, Infinity, false, false]]);
    expect(s('(x-1)/(x-1) > 0').text).toBe('x ≠ 1');
    expect(s('1/(x^2+1) > 0').all).toBe(true);
  });
  it('solves chained inequalities', () => {
    expect(s('1 < x^2 < 4').text).toBe('-2 < x < -1 or 1 < x < 2');
    expect(s('0 <= 2x + 1 < 5').text).toBe('-1/2 ≤ x < 2');
  });
  it('supports other variables and moves terms across', () => {
    expect(solveInequality('t^2 < 9', 't').text).toBe('-3 < t < 3');
    expect(s('x^2 > 3x - 2').text).toBe('x < 1 or x > 2');
  });
  it('rejects unsupported input', () => {
    expect(() => s('x^2 = 1')).toThrow();
    expect(() => s('x^2 - 1')).toThrow();
    expect(() => s('sin(x) > 0')).toThrow(/polynomial/);
    expect(() => s('x^2 >')).toThrow();
  });
});
