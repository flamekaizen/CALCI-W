/**
 * Converts LaTeX produced by the textbook (natural display) editor into Calci
 * expression syntax, e.g.
 *   \frac{1}{2}+\sqrt[3]{8}            → ((1)/(2))+nthRoot(8, 3)
 *   2\frac{1}{3}                        → (2+(1)/(3))          (mixed number, like Casio)
 *   \int_{0}^{\pi}\sin x\,\mathrm{d}x   → integral(sin x, x, 0, pi)
 *   \sum_{n=1}^{10}\left(n^2\right)     → sigma((n^(2)), n, 1, 10)
 *   \frac{\mathrm{d}}{\mathrm{d}x}\left(x^3\right)\Big|_{x=2} → diff((x^(3)), x, 2)
 * Pure string processing, no DOM.
 */

export class LatexError extends Error {}

const SYMBOLS: Record<string, string> = {
  pi: ' pi ', theta: ' theta ', Theta: ' theta ', phi: ' phi ', varphi: ' phi ', tau: ' tau ', infty: ' Infinity ', alpha: ' alpha ', beta: ' beta ',
  gamma: ' gamma_ ', lambda: ' lambda ', mu: ' mu ', sigma: ' sigma_ ', omega: ' omega ', Delta: ' Delta ', delta: ' delta ', epsilon: ' epsilon ', rho: ' rho ',
  cdot: '*', times: '*', ast: '*', div: '/', le: '<=', leq: '<=', ge: '>=', geq: '>=', ne: '!=', neq: '!=', lt: '<', gt: '>', to: ' to ', rightarrow: ' to ',
  '%': '%', percent: '%', exponentialE: ' e ', imaginaryI: ' i ', imaginaryJ: ' i ', degree: ' deg ', circ: ' deg ', prime: "'",
  ',': ' ', ';': ' ', ':': ' ', '!': '', quad: ' ', qquad: ' ', ' ': ' ', lbrace: '{', rbrace: '}', '{': '{', '}': '}', vert: '|', lvert: '|', rvert: '|', mid: '|',
  colon: ':', ldots: '...', dots: '...', cdots: '...', angle: '∠',
};

const FUNCS = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'sinh', 'cosh', 'tanh', 'coth', 'sech', 'csch', 'arcsin', 'arccos', 'arctan', 'arcsec', 'arccsc', 'arccot',
  'ln', 'log', 'exp', 'det', 'max', 'min', 'gcd', 'lcm', 'arg', 'deg', 'lg',
]);

class Parser {
  i = 0;
  constructor(readonly s: string) {}

  peek(n = 0) {
    return this.s[this.i + n];
  }
  eof() {
    return this.i >= this.s.length;
  }
  skipSpace() {
    while (!this.eof() && /\s/.test(this.s[this.i])) this.i++;
  }
  startsWith(t: string) {
    return this.s.startsWith(t, this.i);
  }

  /** Read a command name after a backslash. */
  command(): string {
    this.i++; // backslash
    const m = /^([A-Za-z]+|.)/.exec(this.s.slice(this.i));
    if (!m) throw new LatexError('Incomplete command');
    this.i += m[0].length;
    return m[0];
  }

  /** Raw content of a {...} group (or a single token), unconverted. */
  rawGroup(): string {
    this.skipSpace();
    if (this.peek() === '{') {
      let depth = 0;
      const start = this.i;
      for (; this.i < this.s.length; this.i++) {
        if (this.s[this.i] === '\\') {
          this.i++;
          continue;
        }
        if (this.s[this.i] === '{') depth++;
        else if (this.s[this.i] === '}') {
          depth--;
          if (depth === 0) {
            this.i++;
            return this.s.slice(start + 1, this.i - 1);
          }
        }
      }
      throw new LatexError('Unbalanced braces');
    }
    if (this.peek() === '\\') {
      const start = this.i;
      this.command();
      return this.s.slice(start, this.i);
    }
    return this.s[this.i++] ?? '';
  }

  /** Converted content of a group. */
  group(): string {
    return convert(this.rawGroup());
  }

  /** Optional [..] argument. */
  optional(): string | null {
    this.skipSpace();
    if (this.peek() !== '[') return null;
    let depth = 0;
    const start = this.i;
    for (; this.i < this.s.length; this.i++) {
      if (this.s[this.i] === '[') depth++;
      else if (this.s[this.i] === ']') {
        depth--;
        if (depth === 0) {
          this.i++;
          return convert(this.s.slice(start + 1, this.i - 1));
        }
      }
    }
    throw new LatexError('Unbalanced brackets');
  }

  /** Index of the closing \right matching a \left at the current position. */
  matchRight(from: number): number {
    let depth = 0;
    for (let k = from; k < this.s.length; k++) {
      if (this.s.startsWith('\\left', k) && !/[A-Za-z]/.test(this.s[k + 5] ?? '')) depth++;
      else if (this.s.startsWith('\\right', k) && !/[A-Za-z]/.test(this.s[k + 6] ?? '')) {
        depth--;
        if (depth === 0) return k;
      }
    }
    throw new LatexError('Unbalanced \\left … \\right');
  }

  /** Read a delimiter after \left / \right. */
  delimiter(): string {
    this.skipSpace();
    if (this.peek() === '\\') {
      const c = this.command();
      return { lbrace: '{', rbrace: '}', '{': '{', '}': '}', vert: '|', lvert: '|', rvert: '|', '|': '‖', langle: '(', rangle: ')', lfloor: 'floor(', rfloor: ')', lceil: 'ceil(', rceil: ')' }[c] ?? '';
    }
    return this.s[this.i++] ?? '';
  }

  /**
   * One "primary" for function arguments: a \left…\right group, a {group},
   * or a run of letters/digits (like "x" or "2x"), with an optional power.
   */
  primary(): string {
    this.skipSpace();
    if (this.startsWith('\\left')) {
      const end = this.matchRight(this.i);
      this.i += 5;
      const open = this.delimiter();
      const inner = convert(this.s.slice(this.i, end));
      this.i = end + 6;
      const close = this.delimiter();
      return wrapDelims(open, inner, close);
    }
    if (this.peek() === '(') {
      let depth = 0;
      const start = this.i;
      for (; this.i < this.s.length; this.i++) {
        if (this.s[this.i] === '(') depth++;
        else if (this.s[this.i] === ')' && --depth === 0) {
          this.i++;
          return `(${convert(this.s.slice(start + 1, this.i - 1))})`;
        }
      }
      throw new LatexError('Missing closing parenthesis');
    }
    if (this.peek() === '{') return `(${this.group()})`;
    // run of simple tokens: digits, letters, ^ and commands like \pi, \theta, \frac
    const start = this.i;
    while (!this.eof()) {
      const c = this.peek();
      if (/[0-9A-Za-z.]/.test(c)) this.i++;
      else if (c === '^' || c === '_') {
        this.i++;
        this.rawGroup();
      } else if (c === '\\' && /^\\(pi|theta|phi|tau|frac|dfrac|sqrt|exponentialE)(?![A-Za-z])/.test(this.s.slice(this.i))) {
        const name = this.command();
        if (name === 'sqrt') {
          if (this.peek() === '[') this.optional();
          this.rawGroup();
        } else if (name === 'frac' || name === 'dfrac') {
          this.rawGroup();
          this.rawGroup();
        }
      } else break;
    }
    if (this.i === start) {
      // fall back to a single token
      return convert(this.rawGroup());
    }
    return `(${convert(this.s.slice(start, this.i))})`;
  }
}

function wrapDelims(open: string, inner: string, close: string): string {
  if (open === '|' && close === '|') return `abs(${inner})`;
  if (open === '‖' && close === '‖') return `norm(${inner})`;
  if (open === 'floor(' || open === 'ceil(') return `${open}${inner})`;
  if (open === '{' && close === '}') return `{${inner}}`;
  if (open === '[' && close === ']') return `[${inner}]`;
  if (open === '.' || open === '') return `${inner}${close === '.' ? '' : close}`;
  return `(${inner})`;
}

/** Convert textbook LaTeX into a Calci expression string. */
export function latexToExpr(latex: string): string {
  return convert(latex).replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
}

function convert(src: string): string {
  if (/\\placeholder/.test(src)) throw new LatexError('Fill in the empty box first');
  const p = new Parser(src);
  let out = '';
  /** true when the last emitted thing was a complete number (for mixed fractions) */
  const lastIsInteger = () => /(^|[^0-9.A-Za-z_)\]])\d+\s*$/.test(out);

  while (!p.eof()) {
    const c = p.peek();
    if (c === '\\') {
      const save = p.i;
      const cmd = p.command();
      switch (cmd) {
        case 'frac':
        case 'dfrac':
        case 'tfrac':
        case 'cfrac': {
          const numRaw = p.rawGroup();
          const denRaw = p.rawGroup();
          // derivative operator d/dx
          const dNum = /^\s*(\\mathrm\{d\}|d|\\differentialD)\s*$/.test(numRaw);
          const dDen = /^\s*(?:\\mathrm\{d\}|d|\\differentialD)\s*([A-Za-z])\s*$/.exec(denRaw);
          if (dNum && dDen) {
            const v = dDen[1];
            const body = p.primary();
            p.skipSpace();
            let at: string | null = null;
            const evalBar = /^(\\(Big|big|bigg|Bigg)?(\||vert|rvert)|\||\\right\.?\\?\|?)\s*_/.exec(p.s.slice(p.i));
            if (evalBar || p.startsWith('|_') || p.startsWith('\\bigg|_') || p.startsWith('\\Big|_') || p.startsWith('\\right|_')) {
              // skip the bar
              while (!p.eof() && p.peek() !== '_') p.i++;
              p.i++;
              const sub = p.rawGroup();
              const m = /^\s*([A-Za-z])\s*=\s*(.+)$/.exec(sub);
              at = convert(m ? m[2] : sub);
            }
            if (at === null) throw new LatexError('Add the point: d/dx(…)|x=a');
            out += ` diff(${body}, ${v}, ${at}) `;
            break;
          }
          const num = convert(numRaw);
          const den = convert(denRaw);
          if (lastIsInteger() && /^\s*\d+\s*$/.test(num) && /^\s*\d+\s*$/.test(den)) {
            // mixed number 2 1/3 → (2 + 1/3)
            const m = /(\d+)\s*$/.exec(out)!;
            out = `${out.slice(0, m.index)}(${m[1]}+(${num})/(${den}))`;
          } else out += `((${num})/(${den}))`;
          break;
        }
        case 'sqrt': {
          const n = p.optional();
          const x = p.group();
          out += n ? ` nthRoot(${x}, ${n}) ` : ` sqrt(${x}) `;
          break;
        }
        case 'binom':
        case 'dbinom': {
          const n = p.group();
          const r = p.group();
          out += ` nCr(${n}, ${r}) `;
          break;
        }
        case 'left': {
          p.i = save;
          out += p.primary();
          break;
        }
        case 'right':
          throw new LatexError('Unbalanced \\left … \\right');
        case 'operatorname':
        case 'mathrm':
        case 'text':
        case 'textrm':
        case 'mathit':
        case 'mathbf':
        case 'operatorname*': {
          const name = p.rawGroup().replace(/\\[,;:! ]/g, '').trim();
          if (name === 'd') out += ' d';
          else if (name === 'e') out += ' e ';
          else if (name === 'i') out += ' i ';
          else if (name === 'Ans' || name === 'ans') out += ' ans ';
          else out += ` ${convert(name)} `;
          break;
        }
        case 'int':
        case 'intop': {
          let lo = '';
          let hi = '';
          for (let k = 0; k < 2; k++) {
            p.skipSpace();
            if (p.peek() === '_') {
              p.i++;
              lo = p.group();
            } else if (p.peek() === '^') {
              p.i++;
              hi = p.group();
            } else if (p.startsWith('\\limits')) p.command();
          }
          // body until the differential d<var> at depth 0
          const rest = p.s.slice(p.i);
          const re = /(\\,|\\;|\\:|\\!|\s)*(\\mathrm\{d\}|\\differentialD|\\operatorname\{d\}|\bd)\s*([A-Za-z])\b/g;
          let match: RegExpExecArray | null = null;
          let depth = 0;
          for (let k = 0; k < rest.length; k++) {
            const ch = rest[k];
            if (ch === '{' || ch === '(') depth++;
            else if (ch === '}' || ch === ')') depth--;
            if (depth === 0) {
              re.lastIndex = k;
              const m = re.exec(rest);
              if (m && m.index === k) {
                match = m;
                break;
              }
            }
          }
          if (!match) throw new LatexError('An integral needs dx (or d of another variable) at the end');
          const body = convert(rest.slice(0, match.index));
          p.i += match.index + match[0].length;
          if (!lo || !hi) throw new LatexError('Give both integration limits (this calculator does definite integrals)');
          out += ` integral(${body}, ${match[3]}, ${lo}, ${hi}) `;
          break;
        }
        case 'sum':
        case 'prod': {
          let lo = '';
          let hi = '';
          for (let k = 0; k < 2; k++) {
            p.skipSpace();
            if (p.peek() === '_') {
              p.i++;
              lo = p.rawGroup();
            } else if (p.peek() === '^') {
              p.i++;
              hi = p.group();
            } else if (p.startsWith('\\limits')) p.command();
          }
          const m = /^\s*([A-Za-z])\s*=\s*(.+)$/.exec(lo);
          if (!m || !hi) throw new LatexError(`Write the ${cmd === 'sum' ? 'sum' : 'product'} as n = start below and the end above`);
          const body = p.primary();
          out += ` ${cmd === 'sum' ? 'sigma' : 'product'}(${body}, ${m[1]}, ${convert(m[2])}, ${hi}) `;
          break;
        }
        case 'lim': {
          p.skipSpace();
          if (p.peek() !== '_') throw new LatexError('Write the limit as lim with x → a below');
          p.i++;
          const sub = p.rawGroup();
          const m = /^\s*([A-Za-z])\s*(?:\\to|\\rightarrow|→|->)\s*(.+)$/.exec(sub);
          if (!m) throw new LatexError('Write the limit as lim with x → a below');
          const body = p.primary();
          out += ` limit(${body}, ${m[1]}, ${convert(m[2])}) `;
          break;
        }
        case 'log':
        case 'lg':
        case 'ln': {
          p.skipSpace();
          let base: string | null = null;
          if (cmd === 'log' && p.peek() === '_') {
            p.i++;
            base = p.group();
          }
          const arg = p.primary();
          out += cmd === 'ln' ? ` ln${arg} ` : base ? ` log(${arg}, ${base}) ` : ` log${arg} `;
          break;
        }
        default: {
          if (FUNCS.has(cmd)) {
            let name = cmd.replace(/^arc/, 'a');
            if (name === 'lg') name = 'log';
            p.skipSpace();
            let power: string | null = null;
            if (p.peek() === '^') {
              p.i++;
              const pw = convert(p.rawGroup()).replace(/\s/g, '');
              if (pw === '-1' || pw === '(-1)') name = `a${name}`;
              else power = pw;
            }
            const arg = p.primary();
            out += power ? ` (${name}${arg})^(${power}) ` : ` ${name}${arg} `;
          } else if (cmd in SYMBOLS) out += SYMBOLS[cmd];
          else if (/^[A-Za-z]+$/.test(cmd)) out += ` ${cmd} `;
          // unknown punctuation commands are ignored
          break;
        }
      }
      continue;
    }
    if (c === '^') {
      p.i++;
      p.skipSpace();
      if (p.startsWith('\\circ') || p.startsWith('{\\circ}')) {
        p.rawGroup();
        out += ' deg ';
        continue;
      }
      out += `^(${p.group()})`;
      continue;
    }
    if (c === '_') {
      // subscripts are only meaningful as part of names (x_1 → x_1)
      p.i++;
      const sub = p.rawGroup().replace(/[{}\s]/g, '');
      out = out.replace(/\s+$/, '') + `_${sub}`;
      continue;
    }
    if (c === '{') {
      out += `(${p.group()})`;
      continue;
    }
    if (c === '}') throw new LatexError('Unbalanced braces');
    if (c === '°') {
      p.i++;
      out += ' deg ';
      continue;
    }
    if (c === '~') {
      p.i++;
      out += ' ';
      continue;
    }
    out += c;
    p.i++;
  }
  return out;
}

/* ------------------------------------------------------------------ expr → LaTeX */

/** Convert stored plain expressions into editor LaTeX (best effort). */
export function exprToLatexLite(expr: string): string {
  return expr
    .replace(/\bpi\b/g, '\\pi ')
    .replace(/\btheta\b/g, '\\theta ')
    .replace(/\bsqrt\(/g, '\\sqrt(')
    .replace(/\*/g, '\\cdot ')
    .replace(/<=/g, '\\le ')
    .replace(/>=/g, '\\ge ');
}
