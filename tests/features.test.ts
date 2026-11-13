import { describe, it, expect } from 'vitest';
import { Calculator, evaluate, alternativeForms, recurringDecimal, toDMS } from '../src/core/index';

const labels = (v: unknown, angle: 'rad' | 'deg' = 'rad') => Object.fromEntries(alternativeForms(v, angle).map((f) => [f.label, f.text]));

describe('ClassWiz-style features', () => {
  it('verify mode tests equations', () => {
    expect(evaluate('2 + 2 = 4').value).toBe(true);
    expect(evaluate('sin(30)^2 + cos(30)^2 = 1', { angle: 'deg' }).value).toBe(true);
    expect(evaluate('3 = 4').value).toBe(false);
    // assignments still work
    const c = new Calculator();
    expect(c.evaluate('a = 5').value).toBe(5);
    expect(c.evaluate('f(x) = 2x').ok).toBe(true);
    expect(c.evaluate('nsolve(x^2 = 2, x, 1)').ok).toBe(true);
  });
  it('quotient and remainder, DMS, Pol/Rec', () => {
    expect(evaluate('quorem(17, 5)').text).toBe('3 R 2');
    expect(Number(evaluate('dms(12, 30, 36)').value)).toBeCloseTo(12.51, 12);
    expect(evaluate('Pol(1, 1)', { angle: 'deg' }).text).toMatch(/^\[1\.4142135623\d*, 45\]$/);
    expect(evaluate('Rec(2, 90)', { angle: 'deg' }).text).toBe('[0, 2]');
  });
  it('lists alternative forms', () => {
    expect(recurringDecimal(1, 6)?.text).toBe('0.1(6)');
    expect(recurringDecimal(1, 7)?.tex).toBe('0.\\overline{142857}');
    expect(recurringDecimal(1, 4)).toBeNull();
    expect(toDMS(12.51).text).toBe('12°30′36″');
    const f = labels(7 / 6);
    expect(f.Fraction).toBe('7/6');
    expect(f.Mixed).toBe('1 1/6');
    expect(f.Recurring).toBe('1.1(6)');
    expect(labels(360)['Prime factors']).toBe('2^3 × 3^2 × 5');
    expect(labels(255).Hex).toBe('0xFF');
    expect(labels(4700)['SI prefix']).toBe('4.7 k');
    const z = labels(evaluate('1 + i').value, 'deg');
    expect(z.Polar).toBe('1.414213562∠45°');
  });
  it('finds unknown variables for CALC prompts', () => {
    const c = new Calculator();
    expect(c.unknownSymbols('x^2 + 3y - 5 kg')).toEqual(['x', 'y']);
    expect(c.unknownSymbols('integral(t^2, t, 0, 1)')).toEqual([]);
    expect(c.unknownSymbols('2 pi r')).toEqual(['r']);
    expect(Number(c.evaluate('x^2 + y', { x: 3, y: 1 }).value)).toBe(10);
    expect(c.scope.has('x')).toBe(false);
  });
});

import { graph } from '../src/core/index';
describe('graph calculus', () => {
  const fn = (lines: string[], i = lines.length - 1) => graph.compileGraph(lines.map((text, k) => ({ id: String(k), text }))).items[i];
  it("supports prime notation f'(x)", () => {
    const it2 = fn(['f(x) = x^3', "y = f'(x)", "y = f''(x)"], 1);
    expect(it2.kind).toBe('explicit');
    expect(it2.fn!(2)).toBeCloseTo(12, 6);
    expect(fn(['f(x) = x^3', "y = f'(x)", "y = f''(x)"], 2).fn!(2)).toBeCloseTo(12, 3);
  });
  it('plots integrals, sums and derivatives of x', () => {
    expect(fn(['y = integral(t^2, t, 0, x)']).fn!(3)).toBeCloseTo(9, 8);
    expect(fn(['y = sigma(x^n / n!, n, 0, 12)']).fn!(1)).toBeCloseTo(Math.E, 8);
    expect(fn(['y = diff(sin(t), t, x)']).fn!(0)).toBeCloseTo(1, 8);
  });
  it('compiled comparisons are tolerant', () => {
    expect(fn(['y = (0.1 + 0.2 == 0.3) * x']).fn!(2)).toBe(2);
  });
});
