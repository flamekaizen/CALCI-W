import { describe, it, expect } from 'vitest';
import { parse } from 'mathjs';
import { evaluate, units, compileNode } from '../src/core/index';
import { handle, respond } from '../src/api/handlers';

const api = async (ep: string, body: unknown) => {
  const r = await respond(new Request(`http://x/api/v1/${ep}`, { method: 'POST', body: JSON.stringify(body) }), ep);
  return { status: r.status, body: await r.json() };
};

describe('safe mode (public API)', () => {
  it('cannot poison shared unit definitions through /convert', async () => {
    const r = await api('convert', { query: 'createUnit("m","1 ft",{override:true}) to ft' });
    expect(r.status).toBe(400);
    expect(units.convertUnit(5, 'm', 'ft')).toBeCloseTo(16.4041995, 5);
    expect((await api('convert', { query: '5 ft + 3 inch to cm' })).body.value).toBeCloseTo(160.02, 6);
  });
  it('rejects string-based escapes', () => {
    expect(evaluate('symbolicEqual("evaluate(\\"1\\")", "1")', { safe: true }).ok).toBe(false);
    expect(evaluate('evaluate("1+1")', { safe: true }).ok).toBe(false);
    expect(evaluate('createUnit("zz", "2 m")', { safe: true }).ok).toBe(false);
  });
  it('blocks unsafe calls on every calculus endpoint', async () => {
    for (const [ep, body] of [
      ['simplify', { expr: 'evaluate("1+1")' }],
      ['integral', { expr: 'x+0*evaluate("2")', a: 0, b: 1 }],
      ['taylor', { expr: 'createUnit("q","1 m")' }],
      ['derivative', { expr: 'parse("x")' }],
      ['solve', { type: 'equation', equation: 'evaluate("x") = 2' }],
    ] as const) {
      expect((await api(ep, body)).status, ep).toBe(400);
    }
  });
  it('refuses huge allocations in any argument shape', () => {
    for (const e of ['zeros([1000000, 1000000])', 'ones([5000, 5000])', 'identity([4000, 4000])', 'random([3000, 3000])', 'range(1, 1e9)', 'kron(ones(2000,2000), ones(2000,2000))']) {
      expect(evaluate(e, { safe: true }).ok, e).toBe(false);
    }
    expect(evaluate('zeros(3, 3)', { safe: true }).ok).toBe(true);
    expect(evaluate('zeros(5000, 5000)', { safe: true, bignumber: true }).ok).toBe(false);
  });
  it('bounds CPU: no recursive functions, budgeted calculus loops', () => {
    expect(evaluate('f(n) = n < 2 ? n : f(n-1) + f(n-2)', { safe: true }).ok).toBe(false);
    const t0 = performance.now();
    const r = evaluate('sigma(sigma(1/k^2, k, 1, 1e7), n, 1, 1e7)', { safe: true });
    expect(r.ok).toBe(false);
    expect(performance.now() - t0).toBeLessThan(8000);
    expect(evaluate('sigma(1/n^2, n, 1, Infinity)', { safe: true }).ok).toBe(true);
  });
  it('keeps normal API answers working', () => {
    const r = handle('evaluate', { expr: 'sin(30) + sqrt(16)', angle: 'deg' }).body as any;
    expect(r.result).toBe('4.5');
  });
});

describe('compiled path matches the interpreter', () => {
  const g = (text: string) => compileNode(parse(text), { vars: [] })();
  it('uses tolerant comparisons and math.js conventions', () => {
    expect(g('0.1 + 0.2 == 0.3')).toBe(1);
    expect(g('0.1 + 0.2 > 0.3')).toBe(0);
    expect(g('mod(5, 0)')).toBe(5);
    expect(g('round(-2.5)')).toBe(-3);
    expect(g('lcm(0, 0)')).toBe(0);
    expect(g('acot(-1)')).toBeCloseTo(-Math.PI / 4, 12);
  });
});
