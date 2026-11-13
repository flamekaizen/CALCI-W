import { describe, it, expect } from 'vitest';
import {
  evaluateSequence,
  detectProgression,
  progressionFormula,
  partialSums,
  convergenceHint,
  MAX_SEQUENCE_TERMS,
} from '../src/core/sequences';

describe('explicit sequences', () => {
  it('evaluates u(n) = expr in n', () => {
    const r = evaluateSequence('2n+1', 1, 5);
    expect(r.error).toBeNull();
    expect(r.n).toEqual([1, 2, 3, 4, 5]);
    expect(r.u).toEqual([3, 5, 7, 9, 11]);
    expect(r.v).toBeNull();
    expect(r.info.u?.kind).toBe('explicit');
  });
  it('accepts a "u(n) =" prefix, unicode and a window far from nMin', () => {
    const r = evaluateSequence({ u: 'u(n) = n² − 1' }, 1000, 1002);
    expect(r.u).toEqual([999999, 1002000, 1004003]);
  });
  it('uses the angle unit and library functions', () => {
    const r = evaluateSequence({ u: 'sin(90n) + sq(n)', angle: 'deg', library: ['sq(x) = x^2'] }, 1, 2);
    expect(r.u[0]).toBeCloseTo(2, 12);
    expect(r.u[1]).toBeCloseTo(4, 12);
  });
  it('reports parse errors and the wrong variable', () => {
    expect(evaluateSequence('2x', 1, 3).error).toMatch(/n as the variable/);
    expect(evaluateSequence('2n+', 1, 3).error).toBeTruthy();
    expect(evaluateSequence('', 1, 3).error).toMatch(/Enter/);
    expect(evaluateSequence('n', 5, 1).error).toMatch(/greater/);
  });
  it('keeps going past isolated undefined terms', () => {
    const r = evaluateSequence('1/(n-3)', 1, 5);
    expect(r.u.length).toBe(5);
    expect(r.nonFinite).toEqual({ seq: 'u', n: 3 });
    expect(r.u[4]).toBe(0.5);
  });
});

describe('recursive sequences', () => {
  it('computes Fibonacci', () => {
    const r = evaluateSequence({ u: { expr: 'u(n-1) + u(n-2)', initial: [1, 1] } }, 1, 10);
    expect(r.error).toBeNull();
    expect(r.u).toEqual([1, 1, 2, 3, 5, 8, 13, 21, 34, 55]);
    expect(r.info.u).toEqual({ kind: 'recursive', needs: 2, refs: ['u'] });
  });
  it('computes u(n) = 2u(n-1) + 1 and windows into the middle', () => {
    const r = evaluateSequence({ u: { expr: '2u(n-1)+1', initial: [1] } }, 1, 6);
    expect(r.u).toEqual([1, 3, 7, 15, 31, 63]);
    const w = evaluateSequence({ u: { expr: '2u(n-1)+1', initial: [1] } }, 10, 11);
    expect(w.n).toEqual([10, 11]);
    expect(w.u).toEqual([1023, 2047]);
  });
  it('supports nMin = 0 and bracket notation', () => {
    const r = evaluateSequence({ u: { expr: 'u[n-1] * n', initial: [1] }, nMin: 0 }, 0, 5);
    expect(r.u).toEqual([1, 1, 2, 6, 24, 120]);
  });
  it('requires enough initial terms', () => {
    const r = evaluateSequence({ u: { expr: 'u(n-1) + u(n-2)', initial: [1] } }, 1, 5);
    expect(r.error).toMatch(/needs 2 initial terms: u\(1\), u\(2\)/);
  });
  it('rejects self and future references', () => {
    expect(evaluateSequence({ u: { expr: 'u(n) + 1', initial: [1] } }, 1, 3).error).toMatch(/itself/);
    expect(evaluateSequence({ u: { expr: 'u(n+1)', initial: [1] } }, 1, 3).error).toMatch(/later term/);
  });
  it('clamps the window to nMin', () => {
    const r = evaluateSequence({ u: { expr: 'u(n-1) + 1', initial: [5] }, nMin: 3 }, 1, 4);
    expect(r.n).toEqual([3, 4]);
    expect(r.u).toEqual([5, 6]);
    expect(r.warnings.length).toBe(1);
  });
});

describe('coupled sequences', () => {
  it('evaluates u and v referring to each other', () => {
    // u(n) = v(n-1), v(n) = u(n-1) + v(n-1)  → Fibonacci pair
    const r = evaluateSequence(
      { u: { expr: 'v(n-1)', initial: [0] }, v: { expr: 'u(n-1) + v(n-1)', initial: [1] } },
      1,
      7,
    );
    expect(r.error).toBeNull();
    expect(r.u).toEqual([0, 1, 1, 2, 3, 5, 8]);
    expect(r.v).toEqual([1, 1, 2, 3, 5, 8, 13]);
  });
  it('allows a same-index reference to the other sequence', () => {
    const r = evaluateSequence({ u: 'n^2', v: { expr: 'v(n-1) + u(n)', initial: [1] } }, 1, 4);
    expect(r.v).toEqual([1, 5, 14, 30]);
  });
  it('rejects circular same-index dependencies and undefined v', () => {
    expect(evaluateSequence({ u: 'v(n)', v: 'u(n)' }, 1, 3).error).toMatch(/each other/);
    expect(evaluateSequence({ u: { expr: 'v(n-1)', initial: [1] } }, 1, 3).error).toMatch(/v\(n\) is not defined/);
  });
});

describe('progressions', () => {
  it('detects arithmetic sequences', () => {
    const p = detectProgression(evaluateSequence('3 + 2n', 1, 10).u);
    expect(p).toEqual({ type: 'arithmetic', d: 2, first: 5 });
    expect(progressionFormula(p!, 1)).toBe('u(n) = 5 + 2(n − 1)');
    expect(detectProgression([0.1, 0.2, 0.3, 0.4])).toEqual({ type: 'arithmetic', d: 0.1, first: 0.1 });
  });
  it('detects geometric sequences', () => {
    const p = detectProgression(evaluateSequence({ u: { expr: '-3u(n-1)', initial: [2] } }, 1, 8).u);
    expect(p).toEqual({ type: 'geometric', r: -3, first: 2 });
    expect(progressionFormula(p!, 1)).toBe('u(n) = 2·(−3)^(n − 1)');
    expect(detectProgression([8, 4, 2, 1, 0.5])).toMatchObject({ type: 'geometric', r: 0.5 });
  });
  it('rejects other sequences', () => {
    expect(detectProgression([1, 1, 2, 3, 5, 8])).toBeNull();
    expect(detectProgression([1, 4, 9, 16])).toBeNull();
    expect(detectProgression([1, 2])).toBeNull();
    expect(detectProgression([1, NaN, 3])).toBeNull();
  });
  it('treats a constant sequence as arithmetic with d = 0', () => {
    expect(detectProgression([7, 7, 7, 7])).toEqual({ type: 'arithmetic', d: 0, first: 7 });
  });
});

describe('partial sums', () => {
  it('accumulates terms', () => {
    expect(partialSums([1, 2, 3, 4])).toEqual([1, 3, 6, 10]);
    const s = partialSums(evaluateSequence('1/2^n', 1, 50).u);
    expect(s[s.length - 1]).toBeCloseTo(1, 12);
  });
  it('is compensated', () => {
    const s = partialSums(new Array(10).fill(0.1));
    expect(s[9]).toBe(1);
  });
});

describe('convergence hint', () => {
  it('finds limits', () => {
    const newton = evaluateSequence({ u: { expr: '(u(n-1) + 2/u(n-1))/2', initial: [1] } }, 1, 30).u;
    const h = convergenceHint(newton);
    expect(h.kind).toBe('converges');
    expect(h.limit).toBeCloseTo(Math.SQRT2, 10);
    const g = convergenceHint(evaluateSequence('3 + (-0.5)^n', 1, 40).u);
    expect(g.kind).toBe('converges');
    expect(g.limit).toBeCloseTo(3, 9);
    const e = convergenceHint(evaluateSequence('(1+1/n)^n', 1, 5000).u);
    expect(e.kind).toBe('converges');
  });
  it('finds divergence, oscillation and periodicity', () => {
    expect(convergenceHint(evaluateSequence({ u: { expr: '2u(n-1)+1', initial: [1] } }, 1, 40).u)).toMatchObject({ kind: 'diverges', direction: 1 });
    expect(convergenceHint(evaluateSequence('-n^2', 1, 40).u)).toMatchObject({ kind: 'diverges', direction: -1 });
    expect(convergenceHint(evaluateSequence('(-1)^n * (1 + 1/n)', 1, 2000).u).kind).toMatch(/oscillates|periodic/);
    expect(convergenceHint(evaluateSequence('mod(n, 3)', 1, 30).u)).toMatchObject({ kind: 'periodic', period: 3 });
    expect(convergenceHint([1, 2, 3]).kind).toBe('unknown');
  });
});

describe('limits and safety', () => {
  it('caps the number of terms', () => {
    const r = evaluateSequence('n', 1, 1e6);
    expect(r.u.length).toBe(MAX_SEQUENCE_TERMS);
    expect(r.truncated).toBe(true);
    expect(r.n[r.n.length - 1]).toBe(MAX_SEQUENCE_TERMS);
  });
  it('counts recursive terms from nMin against the cap', () => {
    const r = evaluateSequence({ u: { expr: 'u(n-1)+1', initial: [1] } }, 9990, 10010);
    expect(r.truncated).toBe(true);
    expect(r.n[r.n.length - 1]).toBe(MAX_SEQUENCE_TERMS);
  });
  it('stops a recursive sequence at its first non-finite term', () => {
    const r = evaluateSequence({ u: { expr: 'u(n-1)^2', initial: [10] } }, 1, 100);
    expect(r.truncated).toBe(true);
    expect(r.nonFinite?.seq).toBe('u');
    expect(r.u[r.u.length - 1]).toBe(Infinity);
    expect(r.u.length).toBeLessThan(15);
  });
  it('rejects non-finite ranges and initial terms', () => {
    expect(evaluateSequence('n', 1, Infinity).error).toBeTruthy();
    expect(evaluateSequence({ u: { expr: 'u(n-1)', initial: [NaN] } }, 1, 3).error).toMatch(/finite/);
  });
  it('cannot run arbitrary code', () => {
    expect(evaluateSequence('constructor', 1, 2).error).toBeTruthy();
    expect(evaluateSequence('u.constructor("return 1")()', 1, 2).error).toBeTruthy();
  });
});
