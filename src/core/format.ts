/**
 * Formatting of math.js values for display: notation modes, digit grouping,
 * LaTeX output, and "exact form" recognition (fractions, surds, multiples of pi).
 */
import type { MathJsInstance } from 'mathjs';
import { gcd } from './numerics.js';

export type Notation = 'auto' | 'fix' | 'sci' | 'eng';

export interface FormatOptions {
  notation: Notation;
  /** Significant digits for auto/sci/eng, decimal places for fix. */
  digits: number;
  /** Insert thousands separators. */
  grouping: boolean;
  /** Character used for grouping. */
  groupChar?: string;
}

export const DEFAULT_FORMAT: FormatOptions = { notation: 'auto', digits: 12, grouping: false, groupChar: ',' };

export interface Formatted {
  text: string;
  tex: string;
}

function group(intPart: string, ch: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ch);
}

function trimZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

interface Parts {
  mantissa: string;
  exponent: number | null;
}

function numberParts(v: number, o: FormatOptions): Parts {
  const digits = Math.max(1, Math.min(o.notation === 'fix' ? 20 : 17, o.digits));
  const abs = Math.abs(v);
  switch (o.notation) {
    case 'fix': {
      if (abs >= 1e21) return numberParts(v, { ...o, notation: 'sci' });
      return { mantissa: v.toFixed(digits), exponent: null };
    }
    case 'sci': {
      const [m, e] = v.toExponential(Math.max(0, digits - 1)).split('e');
      return { mantissa: m, exponent: Number(e) };
    }
    case 'eng': {
      if (v === 0) return { mantissa: '0', exponent: 0 };
      let e = Math.floor(Math.log10(abs));
      e -= ((e % 3) + 3) % 3;
      let m = v / Math.pow(10, e);
      let ms = trimZeros(m.toPrecision(digits));
      if (Math.abs(Number(ms)) >= 1000) {
        e += 3;
        m /= 1000;
        ms = trimZeros(m.toPrecision(digits));
      }
      return { mantissa: ms, exponent: e };
    }
    default: {
      if (v === 0) return { mantissa: '0', exponent: null };
      const clean = Number(v.toPrecision(Math.min(15, digits + 3)));
      if (abs >= 1e15 || abs < 1e-6) {
        const [m, e] = clean.toExponential(digits - 1).split('e');
        return { mantissa: trimZeros(m), exponent: Number(e) };
      }
      // String() of a number in [1e-6, 1e15) never uses exponent notation
      return { mantissa: String(Number(clean.toPrecision(digits))), exponent: null };
    }
  }
}

export function formatNumber(v: number, o: FormatOptions = DEFAULT_FORMAT): Formatted {
  if (Number.isNaN(v)) return { text: 'undefined', tex: '\\text{undefined}' };
  if (v === Infinity) return { text: '∞', tex: '\\infty' };
  if (v === -Infinity) return { text: '-∞', tex: '-\\infty' };
  const { mantissa, exponent } = numberParts(v, o);
  let m = mantissa;
  if (o.grouping) {
    const neg = m.startsWith('-');
    const body = neg ? m.slice(1) : m;
    const [i, f] = body.split('.');
    m = (neg ? '-' : '') + group(i, o.groupChar ?? ',') + (f !== undefined ? `.${f}` : '');
  }
  if (Object.is(Number(m), -0)) m = m.replace('-', '');
  if (exponent === null) return { text: m, tex: m.replace(/,/g, '{,}') };
  return { text: `${m}E${exponent}`, tex: `${m.replace(/,/g, '{,}')}\\times10^{${exponent}}` };
}

/* --------------------------------- exact forms --------------------------------- */

/** Continued-fraction rational approximation with bounded denominator. */
export function toFraction(x: number, maxDen = 10000, tol = 1e-12): [number, number] | null {
  if (!Number.isFinite(x)) return null;
  const sign = x < 0 ? -1 : 1;
  let v = Math.abs(x);
  let h1 = 1;
  let h0 = 0;
  let k1 = 0;
  let k0 = 1;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(v);
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (k2 > maxDen) break;
    h0 = h1;
    h1 = h2;
    k0 = k1;
    k1 = k2;
    if (Math.abs(sign * (h1 / k1) - x) <= tol * Math.max(1, Math.abs(x))) return [sign * h1, k1];
    const frac = v - a;
    if (frac < 1e-15) break;
    v = 1 / frac;
  }
  if (k1 && Math.abs(sign * (h1 / k1) - x) <= tol * Math.max(1, Math.abs(x))) return [sign * h1, k1];
  return null;
}

function squareFree(n: number): [number, number] {
  // n = k^2 * m with m square-free
  let k = 1;
  let m = n;
  for (let p = 2; p * p <= m; p++) {
    while (m % (p * p) === 0) {
      m /= p * p;
      k *= p;
    }
  }
  return [k, m];
}

function fracTex(p: number, q: number, inner = ''): string {
  const sign = p < 0 ? '-' : '';
  const ap = Math.abs(p);
  const num = inner ? (ap === 1 ? inner : `${ap}${inner}`) : String(ap);
  return q === 1 ? `${sign}${num}` : `${sign}\\frac{${num}}{${q}}`;
}
function fracText(p: number, q: number, inner = ''): string {
  const sign = p < 0 ? '-' : '';
  const ap = Math.abs(p);
  const num = inner ? (ap === 1 ? inner : `${ap}${inner}`) : String(ap);
  return q === 1 ? `${sign}${num}` : `${sign}${num}/${q}`;
}

const SQUAREFREE_SMALL = [2, 3, 5, 6, 7, 10, 11, 13, 14, 15, 17, 19, 21, 22, 23, 26, 29, 30];

export interface ExactForm extends Formatted {
  kind: 'fraction' | 'pi' | 'sqrt' | 'surd';
  /** Mixed number representation for improper fractions. */
  mixed?: Formatted;
}

/** Recognise a float as a simple exact expression, or null. */
export function exactForm(x: number): ExactForm | null {
  if (!Number.isFinite(x) || Number.isInteger(x) || Math.abs(x) > 1e9 || Math.abs(x) < 1e-9) return null;
  const fr = toFraction(x, 10000, 1e-13);
  if (fr) {
    const [p, q] = fr;
    const res: ExactForm = { kind: 'fraction', text: fracText(p, q), tex: fracTex(p, q) };
    if (Math.abs(p) > q) {
      const w = Math.trunc(p / q);
      const r = Math.abs(p % q);
      res.mixed = { text: `${w} ${r}/${q}`, tex: `${w}\\tfrac{${r}}{${q}}` };
    }
    return res;
  }
  // sqrt(p/q) forms
  const sq = x * x;
  const fs = toFraction(sq, 1000, 1e-12);
  if (fs && fs[0] < 1e6) {
    const [p, q] = fs;
    // x = sqrt(p/q) = sqrt(p*q)/q
    const [k, m] = squareFree(p * q);
    if (m > 1) {
      const g = gcd(k, q);
      const num = (x < 0 ? -1 : 1) * (k / g);
      const den = q / g;
      return { kind: 'sqrt', text: fracText(num, den, `√${m}`), tex: fracTex(num, den, `\\sqrt{${m}}`) };
    }
  }
  // multiples of pi
  const fp = toFraction(x / Math.PI, 360, 1e-12);
  if (fp) {
    const [p, q] = fp;
    return { kind: 'pi', text: fracText(p, q, 'π'), tex: fracTex(p, q, '\\pi') };
  }
  // (a + b*sqrt(n)) / d
  for (const n of SQUAREFREE_SMALL) {
    const s = Math.sqrt(n);
    for (let d = 1; d <= 12; d++) {
      for (let b = -12; b <= 12; b++) {
        if (b === 0) continue;
        const a = x * d - b * s;
        const ar = Math.round(a);
        if (Math.abs(a - ar) < 1e-10 * Math.max(1, Math.abs(x * d)) && Math.abs(ar) <= 1000) {
          const g = gcd(gcd(Math.abs(ar), Math.abs(b)), d);
          const A = ar / g;
          const B = b / g;
          const D = d / g;
          const bAbs = Math.abs(B);
          const surdTxt = `${bAbs === 1 ? '' : bAbs}√${n}`;
          const surdTex = `${bAbs === 1 ? '' : bAbs}\\sqrt{${n}}`;
          const numTxt = A === 0 ? `${B < 0 ? '-' : ''}${surdTxt}` : `${A} ${B < 0 ? '-' : '+'} ${surdTxt}`;
          const numTex = A === 0 ? `${B < 0 ? '-' : ''}${surdTex}` : `${A} ${B < 0 ? '-' : '+'} ${surdTex}`;
          if (D === 1) return { kind: 'surd', text: numTxt, tex: numTex };
          return { kind: 'surd', text: `(${numTxt})/${D}`, tex: `\\frac{${numTex}}{${D}}` };
        }
      }
    }
  }
  return null;
}

/* ------------------------------- generic values ------------------------------- */

export function formatValue(math: MathJsInstance, value: unknown, o: FormatOptions = DEFAULT_FORMAT): Formatted {
  if (value === undefined || value === null) return { text: '', tex: '' };
  if (typeof value === 'number') return formatNumber(value, o);
  if (typeof value === 'boolean') return { text: String(value), tex: `\\text{${value}}` };
  if (typeof value === 'string') return { text: JSON.stringify(value), tex: `\\text{${value.replace(/[{}\\]/g, '')}}` };
  if (typeof value === 'function') {
    const f = value as any;
    const sig = f.syntax ?? `${f.name || 'f'}(…)`;
    return { text: sig, tex: `\\text{${String(sig).replace(/[{}\\]/g, '')}}` };
  }
  const v = value as any;
  if (v.isBigNumber) {
    if (v.isNaN()) return { text: 'undefined', tex: '\\text{undefined}' };
    if (!v.isFinite()) return v.isNeg() ? { text: '-∞', tex: '-\\infty' } : { text: '∞', tex: '\\infty' };
    if (o.notation === 'auto') {
      const s = math.format(v, { notation: 'auto', precision: Math.max(o.digits, 1), lowerExp: -12, upperExp: 30 } as any);
      const [m, e] = s.split('e');
      const mm = o.grouping ? m.replace(/^(-?)(\d+)/, (_x: string, sg: string, d: string) => sg + group(d, o.groupChar ?? ',')) : m;
      if (e !== undefined) return { text: `${mm}E${Number(e)}`, tex: `${mm}\\times10^{${Number(e)}}` };
      return { text: mm, tex: mm.replace(/,/g, '{,}') };
    }
    const notation = o.notation === 'fix' ? 'fixed' : o.notation === 'sci' ? 'exponential' : 'engineering';
    const s = math.format(v, { notation, precision: o.digits } as any);
    const [m, e] = s.split('e');
    if (e !== undefined) return { text: `${m}E${Number(e)}`, tex: `${m}\\times10^{${Number(e)}}` };
    return { text: m, tex: m };
  }
  if (v.isFraction) {
    const n = Number(v.s) * Number(v.n);
    const d = Number(v.d);
    return { text: d === 1 ? String(n) : `${n}/${d}`, tex: fracTex(n, d) };
  }
  if (v.isComplex) {
    const re = v.re as number;
    const im = v.im as number;
    const tol = 1e-14 * Math.max(Math.abs(re), Math.abs(im), 1);
    const reZero = Math.abs(re) < tol;
    const imZero = Math.abs(im) < tol;
    if (imZero) return formatNumber(re, o);
    const imAbs = formatNumber(Math.abs(im), o);
    const imPart = imAbs.text === '1' ? 'i' : `${imAbs.text}i`;
    const imTex = imAbs.text === '1' ? 'i' : `${imAbs.tex}i`;
    if (reZero) return { text: `${im < 0 ? '-' : ''}${imPart}`, tex: `${im < 0 ? '-' : ''}${imTex}` };
    const r = formatNumber(re, o);
    return { text: `${r.text} ${im < 0 ? '-' : '+'} ${imPart}`, tex: `${r.tex} ${im < 0 ? '-' : '+'} ${imTex}` };
  }
  if (v.isUnit) {
    const s = math.format(v, { precision: Math.min(o.digits, 14) } as any);
    const [num, ...rest] = s.split(' ');
    const n = Number(num);
    const unit = rest.join(' ');
    const nf = Number.isFinite(n) ? formatNumber(n, o) : { text: num, tex: num };
    return { text: `${nf.text} ${unit}`.trim(), tex: `${nf.tex}\\,\\mathrm{${unit.replace(/\s+/g, '\\,').replace(/\^(\d+)/g, '^{$1}')}}` };
  }
  if (v.isMatrix || Array.isArray(value)) {
    const arr = v.isMatrix ? v.toArray() : (value as unknown[]);
    return formatArray(math, arr, o);
  }
  if (v.isResultSet) {
    const entries = v.entries as unknown[];
    return formatValue(math, entries[entries.length - 1], o);
  }
  if (v.isNode) return { text: v.toString(), tex: v.toTex() };
  try {
    const s = math.format(value as any, { precision: o.digits } as any);
    return { text: s, tex: `\\text{${s.replace(/[{}\\]/g, '')}}` };
  } catch {
    return { text: String(value), tex: `\\text{${String(value).replace(/[{}\\]/g, '')}}` };
  }
}

function formatArray(math: MathJsInstance, arr: unknown[], o: FormatOptions): Formatted {
  const is2D = arr.length > 0 && Array.isArray(arr[0]);
  if (is2D) {
    const rows = (arr as unknown[][]).map((r) => r.map((c) => formatValue(math, c, o)));
    return {
      text: `[${rows.map((r) => `[${r.map((c) => c.text).join(', ')}]`).join(', ')}]`,
      tex: `\\begin{bmatrix}${rows.map((r) => r.map((c) => c.tex).join(' & ')).join(' \\\\ ')}\\end{bmatrix}`,
    };
  }
  const items = arr.map((c) => formatValue(math, c, o));
  return {
    text: `[${items.map((c) => c.text).join(', ')}]`,
    tex: `\\left[${items.map((c) => c.tex).join(',\\ ')}\\right]`,
  };
}

/** LaTeX for an expression string, with calculator conventions. */
export function expressionTex(math: MathJsInstance, node: any): string {
  return node.toTex({
    parenthesis: 'auto',
    implicit: 'hide',
    handler: (n: any, options: any) => {
      if (n.type === 'FunctionNode') {
        const name = n.fn?.name;
        const args = n.args.map((a: any) => a.toTex(options));
        switch (name) {
          case 'ln':
            return `\\ln\\left(${args[0]}\\right)`;
          case 'log':
            return args.length === 2 ? `\\log_{${args[1]}}\\left(${args[0]}\\right)` : `\\log\\left(${args[0]}\\right)`;
          case 'root':
          case 'nthRoot':
            return `\\sqrt[${args[1] ?? 2}]{${args[0]}}`;
          case 'cbrt':
            return `\\sqrt[3]{${args[0]}}`;
          case 'nCr':
          case 'combinations':
            return `\\binom{${args[0]}}{${args[1]}}`;
          case 'nPr':
            return `{}_{${args[0]}}P_{${args[1]}}`;
          case 'integral':
          case 'nInt':
          case 'fnInt':
            if (args.length === 4) return `\\int_{${args[2]}}^{${args[3]}} ${args[0]}\\,d${args[1]}`;
            break;
          case 'sigma':
          case 'summation':
            if (args.length === 4) return `\\sum_{${args[1]}=${args[2]}}^{${args[3]}} ${args[0]}`;
            break;
          case 'product':
            if (args.length === 4) return `\\prod_{${args[1]}=${args[2]}}^{${args[3]}} ${args[0]}`;
            break;
          case 'diff':
          case 'nDeriv':
            if (args.length >= 3) {
              const ord = args[3] && args[3] !== '1' ? `^{${args[3]}}` : '';
              return `\\left.\\frac{d${ord}}{d${args[1]}${ord}}\\left(${args[0]}\\right)\\right|_{${args[1]}=${args[2]}}`;
            }
            break;
          case 'limit':
            if (args.length >= 3) return `\\lim_{${args[1]}\\to ${args[2]}} ${args[0]}`;
            break;
          case 'abs':
            return `\\left|${args[0]}\\right|`;
          default:
            break;
        }
      }
      if (n.type === 'SymbolNode' && n.name === 'theta') return '\\theta';
      return undefined;
    },
  });
}
