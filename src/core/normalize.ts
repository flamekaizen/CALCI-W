/**
 * Input normalisation: turns the friendly notation people actually type
 * (×, ÷, π, √, superscripts, |x|, log_2(x), Desmos-style piecewise braces…)
 * into syntax the math.js parser understands. Pure string → string, no DOM.
 */

const SUPERSCRIPTS: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+',
};

const SIMPLE: [RegExp, string][] = [
  [/[×✕⨯⋅·∙]/g, '*'],
  [/÷/g, '/'],
  [/[−–—]/g, '-'],
  [/π/g, ' pi '],
  [/θ/g, 'theta'],
  [/τ/g, ' tau '],
  [/φ/g, ' phi '],
  [/∞/g, 'Infinity'],
  [/≤/g, '<='],
  [/≥/g, '>='],
  [/≠/g, '!='],
  [/°/g, ' deg '],
  [/ᴇ/g, 'e'],
  [/\*\*/g, '^'],
  [/ /g, ' '],
];

/** Replace runs of superscript characters with ^(...) */
function replaceSuperscripts(s: string): string {
  return s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, (m) => {
    const inner = [...m].map((c) => SUPERSCRIPTS[c]).join('');
    return inner.length === 1 ? `^${inner}` : `^(${inner})`;
  });
}

/** √x, √2, √(…), ∛x → sqrt(x), cbrt(x) */
function replaceRadicals(s: string): string {
  return s
    .replace(/√\s*\(/g, 'sqrt(')
    .replace(/∛\s*\(/g, 'cbrt(')
    .replace(/√\s*([0-9.]+|[A-Za-z_][A-Za-z_0-9]*)/g, 'sqrt($1)')
    .replace(/∛\s*([0-9.]+|[A-Za-z_][A-Za-z_0-9]*)/g, 'cbrt($1)')
    .replace(/√/g, 'sqrt')
    .replace(/∛/g, 'cbrt');
}

/** Find the index of the bracket matching the one at `open`. */
export function matchBracket(s: string, open: number): number {
  const o = s[open];
  const c = o === '(' ? ')' : o === '[' ? ']' : '}';
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === o) depth++;
    else if (s[i] === c) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** log_2(x), log_{10}(x), log_b(x) → log(x, 2) */
function replaceSubscriptLog(s: string): string {
  const re = /log_\{?([A-Za-z0-9.]+)\}?\s*\(/;
  let guard = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) && guard++ < 50) {
    const open = m.index + m[0].length - 1;
    const close = matchBracket(s, open);
    if (close < 0) break;
    const arg = s.slice(open + 1, close);
    s = `${s.slice(0, m.index)}log(${arg}, ${m[1]})${s.slice(close + 1)}`;
  }
  return s;
}

/**
 * |x| → abs(x). A bar opens when it follows the start, an operator, an opening
 * bracket, a comma or another opening bar; otherwise it closes.
 */
function replaceAbsBars(s: string): string {
  if (!s.includes('|')) return s;
  let out = '';
  let open = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== '|') {
      out += ch;
      continue;
    }
    const prev = out.replace(/\s+$/, '').slice(-1);
    const isOpen = open === 0 || prev === '' || /[+\-*/^(,=<>!:?\[{]/.test(prev) || prev === '|' || out.endsWith('abs(');
    if (isOpen) {
      out += 'abs(';
      open++;
    } else {
      out += ')';
      open--;
    }
  }
  while (open-- > 0) out += ')';
  return out;
}

function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && s.startsWith(sep, i)) {
      parts.push(s.slice(last, i));
      last = i + sep.length;
    }
  }
  parts.push(s.slice(last));
  return parts;
}

function hasTopLevel(s: string, ch: string): boolean {
  return splitTopLevel(s, ch).length > 1;
}

/**
 * Desmos-style braces.
 *  - `{x<0: -x, x}` (contains a colon)  → nested ternary (piecewise)
 *  - trailing `{0<x<2}`                    → returned as restrictions
 */
export function extractBraces(s: string): { expr: string; restrictions: string[] } {
  const restrictions: string[] = [];
  // piecewise first (innermost to outermost by repeated scanning)
  let guard = 0;
  for (;;) {
    if (guard++ > 100) break;
    let replaced = false;
    for (let i = 0; i < s.length; i++) {
      if (s[i] !== '{') continue;
      const close = matchBracket(s, i);
      if (close < 0) break;
      const inner = s.slice(i + 1, close);
      if (inner.includes('{')) continue; // handle innermost first
      if (hasTopLevel(inner, ':')) {
        const cases = splitTopLevel(inner, ',').map((c) => c.trim()).filter(Boolean);
        let expr = 'NaN';
        for (let k = cases.length - 1; k >= 0; k--) {
          const parts = splitTopLevel(cases[k], ':');
          if (parts.length >= 2) expr = `((${parts[0]}) ? (${parts.slice(1).join(':')}) : (${expr}))`;
          else expr = `(${parts[0]})`;
        }
        s = s.slice(0, i) + expr + s.slice(close + 1);
        replaced = true;
        break;
      }
    }
    if (!replaced) break;
  }
  // trailing restrictions
  for (;;) {
    const t = s.trimEnd();
    if (!t.endsWith('}')) break;
    let depth = 0;
    let start = -1;
    for (let i = t.length - 1; i >= 0; i--) {
      if (t[i] === '}') depth++;
      else if (t[i] === '{') {
        depth--;
        if (depth === 0) {
          start = i;
          break;
        }
      }
    }
    if (start < 0) break;
    const inner = t.slice(start + 1, -1).trim();
    if (inner) restrictions.unshift(inner);
    s = t.slice(0, start);
  }
  // a standalone `{cond}` "piecewise without value" means 1 where true
  return { expr: s, restrictions };
}

export interface NormalizeOptions {
  /** Convert |x| bars to abs(). Default true. */
  absBars?: boolean;
}

/** Normalise a user expression for the math.js parser. */
export function normalizeInput(input: string, opts: NormalizeOptions = {}): string {
  let s = input;
  for (const [re, rep] of SIMPLE) s = s.replace(re, rep);
  s = replaceSuperscripts(s);
  s = replaceRadicals(s);
  s = replaceSubscriptLog(s);
  if (opts.absBars !== false) s = replaceAbsBars(s);
  // "ln" is not a math.js builtin name clash, handled via import; "arcsin" → asin
  s = s.replace(/\barc(sin|cos|tan|sec|csc|cot|sinh|cosh|tanh)\b/g, 'a$1');
  s = s.replace(/\b(sin|cos|tan|sec|csc|cot)\^\(?-1\)?\s*\(/g, 'a$1(');
  // "sin x", "ln 2", "sin x^2" → sin(x), ln(2), sin(x^2)  (operand must be simple)
  s = s.replace(
    /\b(a?(?:sin|cos|tan|sec|csc|cot)h?|ln|log|log10|log2|sqrt|cbrt|exp|abs)\s+(?!(?:mod|and|or|not|xor|to|in)\b)(-?[0-9.]+|[A-Za-z_]\w*)(\^(?:\([^()]*\)|[\w.]+))?(?![\w(])/g,
    '$1($2$3)',
  );
  return s.replace(/\s+/g, ' ').trim();
}

export { splitTopLevel };
