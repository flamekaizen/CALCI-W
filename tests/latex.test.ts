import { describe, it, expect } from 'vitest';
import { latexToExpr } from '../src/core/latex';
import { evaluate } from '../src/core/index';

const val = (latex: string, settings = {}) => {
  const expr = latexToExpr(latex);
  const r = evaluate(expr, settings);
  if (!r.ok) throw new Error(`${latex} → ${expr}: ${r.error}`);
  return Number(r.value);
};

describe('textbook LaTeX → expression', () => {
  it('handles fractions, mixed numbers and roots', () => {
    expect(val('\\frac{1}{2}+\\frac{1}{3}')).toBeCloseTo(5 / 6, 12);
    expect(val('2\\frac{1}{3}')).toBeCloseTo(7 / 3, 12);
    expect(val('x\\frac{1}{2}'.replace('x', '4\\cdot'))).toBeCloseTo(2, 12);
    expect(val('\\sqrt{16}+\\sqrt[3]{-8}')).toBeCloseTo(2, 12);
    expect(val('\\frac{\\sqrt{2}}{2}')).toBeCloseTo(Math.SQRT1_2, 12);
    expect(val('\\frac{1+\\frac{1}{2}}{3}')).toBeCloseTo(0.5, 12);
  });
  it('handles powers, delimiters and operators', () => {
    expect(val('2^{10}')).toBe(1024);
    expect(val('\\left(1+2\\right)^{2}\\times3\\div9')).toBeCloseTo(3, 12);
    expect(val('\\left|-5\\right|')).toBe(5);
    expect(val('e^{\\ln\\left(3\\right)}')).toBeCloseTo(3, 12);
    expect(val('5!')).toBe(120);
    expect(val('\\binom{5}{2}')).toBe(10);
    expect(val('2\\cdot\\pi')).toBeCloseTo(2 * Math.PI, 12);
  });
  it('handles trig with powers and inverses', () => {
    expect(val('\\sin^{2}\\left(30\\right)+\\cos^2 30', { angle: 'deg' })).toBeCloseTo(1, 12);
    expect(val('\\sin^{-1}\\left(1\\right)', { angle: 'deg' })).toBeCloseTo(90, 12);
    expect(val('\\sin 30', { angle: 'deg' })).toBeCloseTo(0.5, 12);
    expect(val('\\sin\\left(30^{\\circ}\\right)')).toBeCloseTo(0.5, 12);
  });
  it('handles logs', () => {
    expect(val('\\log_{2}\\left(32\\right)')).toBeCloseTo(5, 12);
    expect(val('\\log\\left(1000\\right)')).toBeCloseTo(3, 12);
    expect(val('\\ln e')).toBeCloseTo(1, 12);
  });
  it('handles calculus templates', () => {
    expect(val('\\int_{0}^{3}x^{2}\\,\\mathrm{d}x')).toBeCloseTo(9, 9);
    expect(val('\\int_{0}^{\\pi}\\sin\\left(x\\right)dx')).toBeCloseTo(2, 9);
    expect(val('\\sum_{n=1}^{10}\\left(n\\right)')).toBe(55);
    expect(val('\\prod_{k=1}^{5}\\left(k\\right)')).toBe(120);
    expect(val('\\frac{\\mathrm{d}}{\\mathrm{d}x}\\left(x^{3}\\right)\\Big|_{x=2}')).toBeCloseTo(12, 8);
    expect(val('\\lim_{x\\to0}\\left(\\frac{\\sin x}{x}\\right)')).toBeCloseTo(1, 9);
  });
  it('reports empty boxes', () => {
    expect(() => latexToExpr('\\frac{\\placeholder{}}{2}')).toThrow(/empty box/);
  });
});
