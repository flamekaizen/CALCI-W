/**
 * Programmer calculator: arbitrary word sizes with BigInt, two's complement,
 * base conversion and a C-like expression language with bitwise operators.
 *
 * Precedence (high to low): unary (- ~ NOT)  >  **  >  * / %  >  + -  >
 * << >> ROL ROR  >  AND NAND  >  XOR XNOR  >  OR NOR
 */

export type Base = 2 | 8 | 10 | 16;
export type WordSize = 8 | 16 | 32 | 64 | 128;

export interface ProgSettings {
  base: Base;
  word: WordSize;
  signed: boolean;
}

export const DEFAULT_PROG: ProgSettings = { base: 10, word: 64, signed: true };

const mask = (word: number) => (1n << BigInt(word)) - 1n;

/** Wrap an integer into the word size, honouring signedness. */
export function wrap(v: bigint, word: number, signed: boolean): bigint {
  const m = mask(word);
  let u = v & m;
  if (signed && u >> BigInt(word - 1) === 1n) u -= 1n << BigInt(word);
  return u;
}

export function toUnsigned(v: bigint, word: number): bigint {
  return v & mask(word);
}

/** Format in a base. Negative numbers in non-decimal bases use two's complement. */
export function toBase(v: bigint, base: Base, word: number, opts: { group?: boolean; pad?: boolean } = {}): string {
  let s: string;
  if (base === 10) s = v.toString(10);
  else {
    s = toUnsigned(v, word).toString(base).toUpperCase();
    if (opts.pad) {
      const len = base === 2 ? word : base === 16 ? word / 4 : Math.ceil(word / 3);
      s = s.padStart(len, '0');
    }
  }
  if (opts.group) {
    const size = base === 2 ? 4 : base === 16 ? 4 : 3;
    const sep = base === 10 ? ',' : ' ';
    const neg = s.startsWith('-');
    const body = neg ? s.slice(1) : s;
    const grouped = body.replace(new RegExp(`\\B(?=([0-9A-F]{${size}})+(?![0-9A-F]))`, 'g'), sep);
    s = (neg ? '-' : '') + grouped;
  }
  return s;
}

export function bitsOf(v: bigint, word: number): number[] {
  const u = toUnsigned(v, word);
  const out: number[] = [];
  for (let i = 0; i < word; i++) out.push(Number((u >> BigInt(i)) & 1n));
  return out;
}

export function toggleBit(v: bigint, bit: number, s: ProgSettings): bigint {
  return wrap(toUnsigned(v, s.word) ^ (1n << BigInt(bit)), s.word, s.signed);
}

/* ------------------------------------ parser ------------------------------------ */

type Tok = { t: 'num'; v: bigint } | { t: 'op'; v: string } | { t: 'lp' } | { t: 'rp' } | { t: 'ans' };

const WORD_OPS: Record<string, string> = {
  AND: '&', OR: '|', XOR: '^', NOT: '~', NAND: 'NAND', NOR: 'NOR', XNOR: 'XNOR', MOD: '%',
  LSH: '<<', RSH: '>>', SHL: '<<', SHR: '>>', ROL: 'ROL', ROR: 'ROR',
};

const DIGITS: Record<Base, RegExp> = { 2: /[01]/, 8: /[0-7]/, 10: /[0-9]/, 16: /[0-9A-Fa-f]/ };

export class ProgError extends Error {}

function tokenize(src: string, base: Base): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const s = src.replace(/[×]/g, '*').replace(/[÷]/g, '/').replace(/[−]/g, '-');
  while (i < s.length) {
    const c = s[i];
    if (/\s|_|'/.test(c)) {
      i++;
      continue;
    }
    if (c === '(') {
      toks.push({ t: 'lp' });
      i++;
      continue;
    }
    if (c === ')') {
      toks.push({ t: 'rp' });
      i++;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (two === '<<' || two === '>>' || two === '**') {
      toks.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if ('+-*/%&|^~!'.includes(c)) {
      toks.push({ t: 'op', v: c === '!' ? '~' : c });
      i++;
      continue;
    }
    // prefixed literals
    const pre = s.slice(i, i + 2).toLowerCase();
    if (pre === '0x' || pre === '0b' || pre === '0o' || pre === '0d') {
      const b: Base = pre === '0x' ? 16 : pre === '0b' ? 2 : pre === '0o' ? 8 : 10;
      let j = i + 2;
      while (j < s.length && (DIGITS[b].test(s[j]) || s[j] === '_')) j++;
      const digits = s.slice(i + 2, j).replace(/_/g, '');
      if (!digits) throw new ProgError(`Invalid literal ${s.slice(i, j)}`);
      toks.push({ t: 'num', v: parseBig(digits, b) });
      i = j;
      continue;
    }
    if (/[A-Za-z0-9]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9]/.test(s[j])) j++;
      const word = s.slice(i, j);
      const up = word.toUpperCase();
      if (WORD_OPS[up]) {
        toks.push({ t: 'op', v: WORD_OPS[up] });
        i = j;
        continue;
      }
      if (up === 'ANS') {
        toks.push({ t: 'ans' });
        i = j;
        continue;
      }
      if (![...word].every((ch) => DIGITS[base].test(ch))) throw new ProgError(`“${word}” is not a valid base-${base} number`);
      toks.push({ t: 'num', v: parseBig(word, base) });
      i = j;
      continue;
    }
    throw new ProgError(`Unexpected “${c}”`);
  }
  return toks;
}

export function parseBig(digits: string, base: Base): bigint {
  const prefix = base === 16 ? '0x' : base === 8 ? '0o' : base === 2 ? '0b' : '';
  return BigInt(prefix + digits);
}

const BINARY_LEVELS: string[][] = [
  ['|', 'NOR'],
  ['^', 'XNOR'],
  ['&', 'NAND'],
  ['<<', '>>', 'ROL', 'ROR'],
  ['+', '-'],
  ['*', '/', '%'],
];

export function progEvaluate(src: string, s: ProgSettings, ans: bigint = 0n): bigint {
  const toks = tokenize(src, s.base);
  if (!toks.length) throw new ProgError('Empty expression');
  let pos = 0;
  const W = BigInt(s.word);
  const w = (v: bigint) => wrap(v, s.word, s.signed);
  const peek = () => toks[pos];

  const apply = (op: string, a: bigint, b: bigint): bigint => {
    switch (op) {
      case '+': return w(a + b);
      case '-': return w(a - b);
      case '*': return w(a * b);
      case '/':
        if (b === 0n) throw new ProgError('Division by zero');
        return w(a / b);
      case '%':
        if (b === 0n) throw new ProgError('Division by zero');
        return w(a % b);
      case '**':
        if (b < 0n) throw new ProgError('Negative exponent');
        if (b > 4096n) throw new ProgError('Exponent too large');
        return w(a ** b);
      case '&': return w(a & b);
      case '|': return w(a | b);
      case '^': return w(a ^ b);
      case 'NAND': return w(~(a & b));
      case 'NOR': return w(~(a | b));
      case 'XNOR': return w(~(a ^ b));
      case '<<': return w(toUnsigned(a, s.word) << (b % (W + 1n)));
      case '>>': return w(s.signed ? a >> b : toUnsigned(a, s.word) >> b);
      case 'ROL': {
        const k = ((b % W) + W) % W;
        const u = toUnsigned(a, s.word);
        return w((u << k) | (u >> (W - k)));
      }
      case 'ROR': {
        const k = ((b % W) + W) % W;
        const u = toUnsigned(a, s.word);
        return w((u >> k) | (u << (W - k)));
      }
      default:
        throw new ProgError(`Unknown operator ${op}`);
    }
  };

  const primary = (): bigint => {
    const t = peek();
    if (!t) throw new ProgError('Incomplete expression');
    if (t.t === 'num') {
      pos++;
      return w(t.v);
    }
    if (t.t === 'ans') {
      pos++;
      return w(ans);
    }
    if (t.t === 'lp') {
      pos++;
      const v = binary(0);
      if (peek()?.t !== 'rp') throw new ProgError('Missing closing parenthesis');
      pos++;
      return v;
    }
    if (t.t === 'op' && (t.v === '-' || t.v === '~' || t.v === '+')) {
      pos++;
      const v = power();
      return t.v === '-' ? w(-v) : t.v === '~' ? w(~v) : v;
    }
    throw new ProgError('Value expected');
  };
  const power = (): bigint => {
    const base = primary();
    const t = peek();
    if (t && t.t === 'op' && t.v === '**') {
      pos++;
      return apply('**', base, power());
    }
    return base;
  };
  const binary = (level: number): bigint => {
    if (level >= BINARY_LEVELS.length) return power();
    let left = binary(level + 1);
    for (;;) {
      const t = peek();
      if (!t || t.t !== 'op' || !BINARY_LEVELS[level].includes(t.v)) break;
      pos++;
      left = apply(t.v, left, binary(level + 1));
    }
    return left;
  };
  const v = binary(0);
  if (pos < toks.length) throw new ProgError('Unexpected input after expression');
  return v;
}

/* --------------------------------- IEEE-754 view --------------------------------- */

export interface FloatBits {
  bits: string;
  sign: number;
  exponentBits: string;
  mantissaBits: string;
  exponent: number;
  hex: string;
  kind: 'normal' | 'subnormal' | 'zero' | 'infinity' | 'nan';
  stored: number;
}

export function floatBits(x: number, width: 32 | 64 = 64): FloatBits {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  let bits = '';
  let stored = x;
  if (width === 32) {
    dv.setFloat32(0, x);
    stored = dv.getFloat32(0);
    bits = dv.getUint32(0).toString(2).padStart(32, '0');
  } else {
    dv.setFloat64(0, x);
    bits = dv.getBigUint64(0).toString(2).padStart(64, '0');
  }
  const eLen = width === 32 ? 8 : 11;
  const bias = width === 32 ? 127 : 1023;
  const exponentBits = bits.slice(1, 1 + eLen);
  const mantissaBits = bits.slice(1 + eLen);
  const e = parseInt(exponentBits, 2);
  const allOnes = e === (1 << eLen) - 1;
  const mZero = !mantissaBits.includes('1');
  const kind: FloatBits['kind'] = allOnes ? (mZero ? 'infinity' : 'nan') : e === 0 ? (mZero ? 'zero' : 'subnormal') : 'normal';
  const hex = BigInt(`0b${bits}`).toString(16).toUpperCase().padStart(width / 4, '0');
  return { bits, sign: Number(bits[0]), exponentBits, mantissaBits, exponent: e === 0 ? 1 - bias : e - bias, hex, kind, stored };
}

/** Printable character for a code point, or a control-code name. */
export function charOf(v: bigint): string {
  const n = Number(v);
  if (n < 0 || n > 0x10ffff) return '';
  const CTRL = ['NUL', 'SOH', 'STX', 'ETX', 'EOT', 'ENQ', 'ACK', 'BEL', 'BS', 'TAB', 'LF', 'VT', 'FF', 'CR', 'SO', 'SI', 'DLE', 'DC1', 'DC2', 'DC3', 'DC4', 'NAK', 'SYN', 'ETB', 'CAN', 'EM', 'SUB', 'ESC', 'FS', 'GS', 'RS', 'US'];
  if (n < 32) return CTRL[n];
  if (n === 32) return 'SPACE';
  if (n === 127) return 'DEL';
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}
