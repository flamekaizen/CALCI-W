/**
 * Spreadsheet engine (framework-free): A1-style cells, formulas in Calci
 * expression syntax, ranges, dependency-ordered evaluation with cycle
 * detection, relative/absolute reference shifting for fills, CSV import/export.
 */
import { Calculator, friendlyError, prepare } from './engine.js';
import { assertSafe, parseWith, resetBudget, toNumber } from './math.js';

/* ------------------------------------------------------------------ geometry */

export const SHEET_COLS = 8;
export const SHEET_ROWS = 50;
export const COLUMN_LETTERS: string[] = Array.from({ length: SHEET_COLS }, (_, i) => String.fromCharCode(65 + i));

/** Raw cell inputs keyed by address ("A1"). Missing or blank = empty. */
export type SheetCells = Record<string, string>;

export interface CellResult {
  value: unknown;
  /** Display text (formatted value, or an error code such as #CYCLE). */
  text: string;
  /** Present when the cell is in error; a human-readable explanation. */
  error?: string;
}
export type SheetResults = Record<string, CellResult>;

export interface SheetOptions {
  /** Calculator providing settings, variables and the user library. A fresh one is used when omitted. */
  calculator?: Calculator;
}

export interface CellRef {
  /** 0-based column index. */
  col: number;
  /** 0-based row index. */
  row: number;
  colAbs?: boolean;
  rowAbs?: boolean;
}

export const colName = (col: number): string => COLUMN_LETTERS[col] ?? '?';

/** 0-based (row, col) → "A1". */
export function cellAddress(row: number, col: number): string {
  return `${colName(col)}${row + 1}`;
}

export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < SHEET_ROWS && col >= 0 && col < SHEET_COLS;
}

/** "B3", "$b$3" → { row: 2, col: 1 }; null when malformed or out of bounds. */
export function parseAddress(addr: string): CellRef | null {
  const m = /^(\$?)([A-Za-z])(\$?)(\d+)$/.exec(addr.trim());
  if (!m) return null;
  const col = m[2].toUpperCase().charCodeAt(0) - 65;
  const row = Number(m[4]) - 1;
  if (!inBounds(row, col)) return null;
  return { col, row, colAbs: !!m[1], rowAbs: !!m[3] };
}

export function refText(r: CellRef): string {
  return `${r.colAbs ? '$' : ''}${colName(r.col)}${r.rowAbs ? '$' : ''}${r.row + 1}`;
}

/** Every address in the rectangle spanned by two corners (row-major). */
export function rangeAddresses(a: CellRef, b: CellRef): string[] {
  const out: string[] = [];
  const [r0, r1] = [Math.min(a.row, b.row), Math.max(a.row, b.row)];
  const [c0, c1] = [Math.min(a.col, b.col), Math.max(a.col, b.col)];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (inBounds(r, c)) out.push(cellAddress(r, c));
  return out;
}

/* ------------------------------------------------------------------ formula tokens */

type Token =
  | { type: 'text'; s: string }
  | { type: 'ref'; ref: CellRef; s: string }
  | { type: 'range'; from: CellRef; to: CellRef; s: string }
  | { type: 'bad'; s: string };

const REF_RE = /(\$?)([A-Za-z])(\$?)(\d+)(?::(\$?)([A-Za-z])(\$?)(\d+))?(?![A-Za-z0-9_$])/g;

function makeRef(colAbs: string, letter: string, rowAbs: string, digits: string): CellRef {
  return { col: letter.toUpperCase().charCodeAt(0) - 65, row: Number(digits) - 1, colAbs: !!colAbs, rowAbs: !!rowAbs };
}
const validRef = (r: CellRef) => inBounds(r.row, r.col);
const isColumnLetter = (ch: string) => {
  const c = ch.toUpperCase().charCodeAt(0) - 65;
  return c >= 0 && c < SHEET_COLS;
};

/** Is the match at `index` the start of a cell reference (not part of an identifier or number)? */
function startsReference(src: string, index: number, letter: string): boolean {
  let i = index;
  while (i > 0 && /[A-Za-z0-9_.$]/.test(src[i - 1])) i--;
  const prefix = src.slice(i, index);
  if (!prefix) return true;
  // implicit multiplication such as 2A1, but not exponents (2e1) or hex literals (0x1A2)
  return /^[0-9.]+$/.test(prefix) && !/^e$/i.test(letter);
}

function tokenizeCode(src: string, out: Token[]) {
  let last = 0;
  REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_RE.exec(src))) {
    if (!isColumnLetter(m[2]) || !startsReference(src, m.index, m[2])) {
      // let the scan continue from the next character so that e.g. "x1:A3" still finds A3
      REF_RE.lastIndex = m.index + 1;
      continue;
    }
    if (m.index > last) out.push({ type: 'text', s: src.slice(last, m.index) });
    const from = makeRef(m[1], m[2], m[3], m[4]);
    if (m[6] !== undefined) {
      const to = makeRef(m[5], m[6], m[7], m[8]);
      out.push(validRef(from) && validRef(to) ? { type: 'range', from, to, s: m[0] } : { type: 'bad', s: m[0] });
    } else {
      out.push(validRef(from) ? { type: 'ref', ref: from, s: m[0] } : { type: 'bad', s: m[0] });
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ type: 'text', s: src.slice(last) });
}

/** Split a formula body into text, references and ranges (quoted strings are left alone). */
export function tokenizeFormula(body: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let codeStart = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '"' || ch === "'") {
      tokenizeCode(body.slice(codeStart, i), out);
      let j = i + 1;
      while (j < body.length && body[j] !== ch) j += body[j] === '\\' ? 2 : 1;
      out.push({ type: 'text', s: body.slice(i, j + 1) });
      i = codeStart = j + 1;
    } else i++;
  }
  tokenizeCode(body.slice(codeStart), out);
  return out;
}

export const isFormula = (raw: string | undefined): boolean => !!raw && raw.trimStart().startsWith('=');

/** Addresses a raw input depends on (refs and every cell of each range), deduplicated. */
export function formulaRefs(raw: string): string[] {
  if (!isFormula(raw)) return [];
  const set = new Set<string>();
  for (const t of tokenizeFormula(raw.trimStart().slice(1))) {
    if (t.type === 'ref') set.add(cellAddress(t.ref.row, t.ref.col));
    else if (t.type === 'range') for (const a of rangeAddresses(t.from, t.to)) set.add(a);
  }
  return [...set];
}

/* ------------------------------------------------------------------ fill / copy */

function shiftRef(r: CellRef, dRow: number, dCol: number): CellRef | null {
  const n = { ...r, row: r.rowAbs ? r.row : r.row + dRow, col: r.colAbs ? r.col : r.col + dCol };
  return validRef(n) ? n : null;
}

/**
 * Shift the relative references of a raw input as if it were copied by
 * (dRow, dCol): `=A1*2` moved down one row becomes `=A2*2`, `$A$1` stays.
 * References pushed off the sheet become `#REF!`. Literals are returned unchanged.
 */
export function shiftFormula(raw: string, dRow: number, dCol: number): string {
  if (!isFormula(raw) || (dRow === 0 && dCol === 0)) return raw;
  const lead = raw.slice(0, raw.indexOf('=') + 1);
  return (
    lead +
    tokenizeFormula(raw.slice(lead.length))
      .map((t) => {
        if (t.type === 'ref') {
          const r = shiftRef(t.ref, dRow, dCol);
          return r ? refText(r) : '#REF!';
        }
        if (t.type === 'range') {
          const a = shiftRef(t.from, dRow, dCol);
          const b = shiftRef(t.to, dRow, dCol);
          return a && b ? `${refText(a)}:${refText(b)}` : '#REF!';
        }
        return t.s;
      })
      .join('')
  );
}

/** Copy the cell at `source` into every cell of the rectangle source…target, shifting references. */
export function fillRange(cells: SheetCells, source: string, target: string): SheetCells {
  const s = parseAddress(source);
  const t = parseAddress(target);
  if (!s || !t) return cells;
  const raw = cells[cellAddress(s.row, s.col)] ?? '';
  const next = { ...cells };
  for (const addr of rangeAddresses(s, t)) {
    const p = parseAddress(addr)!;
    if (p.row === s.row && p.col === s.col) continue;
    const v = shiftFormula(raw, p.row - s.row, p.col - s.col);
    if (v.trim()) next[addr] = v;
    else delete next[addr];
  }
  return next;
}

/** Fill the source cell down to `toRow` (0-based, inclusive). */
export const fillDown = (cells: SheetCells, source: string, toRow: number): SheetCells => {
  const s = parseAddress(source);
  return s ? fillRange(cells, source, cellAddress(Math.min(SHEET_ROWS - 1, Math.max(0, toRow)), s.col)) : cells;
};

/** Fill the source cell right to `toCol` (0-based, inclusive). */
export const fillRight = (cells: SheetCells, source: string, toCol: number): SheetCells => {
  const s = parseAddress(source);
  return s ? fillRange(cells, source, cellAddress(s.row, Math.min(SHEET_COLS - 1, Math.max(0, toCol)))) : cells;
};

/* ------------------------------------------------------------------ evaluation */

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** Spreadsheet functions (any case) → internal scope names; they flatten ranges and scalars. */
const SHEET_FUNCS: Record<string, string> = {
  sum: 'sum',
  mean: 'mean',
  average: 'mean',
  avg: 'mean',
  min: 'min',
  max: 'max',
  count: 'count',
  median: 'median',
  std: 'std',
  stdev: 'std',
  var: 'variance',
  variance: 'variance',
  product: 'prod',
  prod: 'prod',
};
export const SHEET_FUNCTIONS = ['Sum', 'Mean', 'Min', 'Max', 'Count', 'Median', 'Std', 'Var', 'Product'];
const FUNC_RE = new RegExp(`(?<![A-Za-z0-9_.$])(?:${Object.keys(SHEET_FUNCS).join('|')})(?=\\s*\\()`, 'gi');
const fnSymbol = (name: string) => `sheet_fn_${name}`;

class SheetError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const isEmpty = (raw: string | undefined) => raw === undefined || raw.trim() === '';

function isNumeric(v: unknown): boolean {
  if (typeof v === 'number') return true;
  const o = v as any;
  return !!(o?.isBigNumber || o?.isFraction);
}

function nonFinite(v: unknown): boolean {
  if (typeof v === 'number') return !Number.isFinite(v);
  const o = v as any;
  if (o?.isBigNumber) return !o.isFinite();
  return false;
}

/**
 * Evaluate every non-empty cell. Formulas start with `=`; anything else is a
 * number or a text literal (a leading apostrophe forces text).
 */
export function evaluateSheet(cells: SheetCells, opts: SheetOptions = {}): SheetResults {
  const calc = opts.calculator ?? new Calculator();
  const math = calc.math;
  const out: SheetResults = {};
  const raws = new Map<string, string>();
  for (const [addr, raw] of Object.entries(cells)) {
    const p = parseAddress(addr);
    if (!p || isEmpty(raw)) continue;
    raws.set(cellAddress(p.row, p.col), raw);
  }

  const base = new Map<string, unknown>(calc.scope);
  const flatten = (args: unknown[]): unknown[] => {
    const vals: unknown[] = [];
    for (const a of args) {
      const o = a as any;
      if (Array.isArray(a) || o?.isMatrix) vals.push(...(math.flatten(o?.isMatrix ? o.toArray() : a) as unknown[]));
      else vals.push(a);
    }
    return vals;
  };
  for (const [key, name] of Object.entries(SHEET_FUNCS)) {
    if (base.has(fnSymbol(key))) continue;
    const fn = (...args: unknown[]) => {
      const vals = flatten(args);
      if (name === 'count') return vals.filter(isNumeric).length;
      if (!vals.length) {
        if (name === 'sum') return 0;
        if (name === 'prod') return 1;
        throw new Error(`${key}() needs at least one value`);
      }
      if ((name === 'std' || name === 'variance') && vals.length < 2) throw new Error(`${key}() needs at least two values`);
      return (math as any)[name](vals);
    };
    base.set(fnSymbol(key), fn);
  }

  const zero = () => (calc.settings.bignumber ? math.bignumber(0) : 0);
  const literal = (raw: string): CellResult => {
    const t = raw.trim();
    if (t.startsWith("'")) return { value: t.slice(1), text: t.slice(1) };
    if (NUMBER_RE.test(t)) {
      const value = calc.settings.bignumber ? math.bignumber(t) : Number(t);
      return { value, text: calc.format(value).text };
    }
    return { value: t, text: t };
  };

  const depsOf = (raw: string) => (isFormula(raw) ? formulaRefs(raw).filter((a) => raws.has(a)) : []);

  const compute = (addr: string): CellResult => {
    const raw = raws.get(addr)!;
    if (!isFormula(raw)) return literal(raw);
    const body = raw.trimStart().slice(1);
    try {
      if (!body.trim()) throw new SheetError('#ERR', 'Empty formula');
      const tokens = tokenizeFormula(body);
      const scope = new Map(base);
      const refValue = (a: string): unknown => {
        const r = out[a];
        if (!r) return zero();
        if (r.error) throw new SheetError(r.text, `${a} has an error: ${r.error}`);
        return r.value;
      };
      let rangeN = 0;
      let expr = '';
      for (const t of tokens) {
        if (t.type === 'text') expr += t.s;
        else if (t.type === 'bad') throw new SheetError('#REF', `${t.s} is outside the sheet (A1:${cellAddress(SHEET_ROWS - 1, SHEET_COLS - 1)})`);
        else if (t.type === 'ref') {
          const a = cellAddress(t.ref.row, t.ref.col);
          scope.set(a, refValue(a));
          expr += a;
        } else {
          const vals: unknown[] = [];
          for (const a of rangeAddresses(t.from, t.to)) {
            const v = out[a] ? refValue(a) : undefined;
            if (v !== undefined && isNumeric(v)) vals.push(v);
            else if (v !== undefined && typeof v !== 'string') vals.push(v);
          }
          const name = `sheet_range_${rangeN++}`;
          scope.set(name, vals);
          expr += name;
        }
      }
      if (/#REF/i.test(expr)) throw new SheetError('#REF', 'Invalid reference (#REF!)');
      expr = expr.replace(FUNC_RE, (fn: string) => fnSymbol(fn.toLowerCase()));
      const node = parseWith(math, prepare(expr));
      if (calc.settings.safe) assertSafe(node);
      resetBudget(math);
      let value: unknown = node.compile().evaluate(scope);
      if (value && (value as any).isResultSet) {
        const entries = (value as any).entries as unknown[];
        value = entries[entries.length - 1];
      }
      if (value === undefined || value === null) return { value: undefined, text: '' };
      if (typeof value === 'function') throw new SheetError('#ERR', 'A formula must produce a value, not a function');
      if (nonFinite(value) && /\/|\bmod\b/.test(expr)) {
        return { value, text: '#DIV/0', error: 'Division by zero' };
      }
      if (typeof value === 'string') return { value, text: value };
      return { value, text: calc.format(value).text };
    } catch (e) {
      if (e instanceof SheetError) return { value: undefined, text: e.code, error: e.message };
      return { value: undefined, text: '#ERR', error: friendlyError(e) };
    }
  };

  // depth-first, dependency-ordered evaluation with cycle detection
  const stack: string[] = [];
  const onStack = new Set<string>();
  const visit = (addr: string) => {
    if (out[addr]) return;
    if (onStack.has(addr)) {
      const cycle = stack.slice(stack.indexOf(addr));
      const path = [...cycle, addr].join(' → ');
      for (const a of cycle) out[a] = { value: undefined, text: '#CYCLE', error: `Circular reference: ${path}` };
      return;
    }
    stack.push(addr);
    onStack.add(addr);
    for (const d of depsOf(raws.get(addr)!)) visit(d);
    stack.pop();
    onStack.delete(addr);
    if (!out[addr]) out[addr] = compute(addr);
  };
  for (const addr of raws.keys()) visit(addr);
  return out;
}

/** Computed value of one cell in a results map (undefined when empty or in error). */
export function cellValue(results: SheetResults, addr: string): unknown {
  return results[addr.toUpperCase()]?.value;
}

/* ------------------------------------------------------------------ column statistics */

export interface ColumnStats {
  count: number;
  sum: number;
  mean: number;
}

/** Count / sum / mean of the numeric values in a column (0-based index). */
export function columnStats(results: SheetResults, col: number): ColumnStats {
  return rangeStats(results, { row: 0, col }, { row: SHEET_ROWS - 1, col });
}

/** Count / sum / mean of the numeric values in the rectangle a…b (errors and text are skipped). */
export function rangeStats(results: SheetResults, a: CellRef, b: CellRef): ColumnStats {
  let count = 0;
  let sum = 0;
  for (const addr of rangeAddresses(a, b)) {
    const res = results[addr];
    if (!res || res.error || !isNumeric(res.value)) continue;
    const n = toNumber(res.value);
    if (!Number.isFinite(n)) continue;
    count++;
    sum += n;
  }
  return { count, sum, mean: count ? sum / count : NaN };
}

/** Size of the used area: rows and columns up to the last non-empty cell. */
export function usedBounds(cells: SheetCells): { rows: number; cols: number } {
  let rows = 0;
  let cols = 0;
  for (const [addr, raw] of Object.entries(cells)) {
    const p = parseAddress(addr);
    if (!p || isEmpty(raw)) continue;
    rows = Math.max(rows, p.row + 1);
    cols = Math.max(cols, p.col + 1);
  }
  return { rows, cols };
}

/* ------------------------------------------------------------------ CSV */

function csvField(s: string, sep: string): string {
  return s.includes(sep) || /["\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Plain text for a computed value in CSV (no digit grouping, full precision for numbers). */
function csvValue(r: CellResult | undefined): string {
  if (!r) return '';
  if (r.error) return r.text;
  const v = r.value as any;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : r.text;
  if (v?.isBigNumber || v?.isFraction) return v.toString();
  return r.text;
}

/**
 * Export the used area as CSV. `mode: 'raw'` writes the inputs (formulas
 * round-trip); `'values'` writes the computed values (pass `results`).
 */
export function toCSV(cells: SheetCells, opts: { mode?: 'raw' | 'values'; results?: SheetResults; separator?: string } = {}): string {
  const sep = opts.separator ?? ',';
  const mode = opts.mode ?? 'raw';
  const results = mode === 'values' ? opts.results ?? evaluateSheet(cells) : undefined;
  const { rows, cols } = usedBounds(cells);
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const fields: string[] = [];
    for (let c = 0; c < cols; c++) {
      const addr = cellAddress(r, c);
      const raw = cells[addr] ?? '';
      fields.push(csvField(results ? (isEmpty(raw) ? '' : csvValue(results[addr])) : raw, sep));
    }
    lines.push(fields.join(sep));
  }
  return lines.join('\r\n');
}

/** Guess the delimiter from the first line (comma, semicolon or tab), ignoring quoted text. */
function detectSeparator(text: string): string {
  const first = (text.split(/\r?\n/).find((l) => l.trim()) ?? '').replace(/"[^"]*"/g, '');
  const counts: [string, number][] = [',', ';', '\t'].map((s) => [s, first.split(s).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/** Parse CSV text (RFC 4180 quoting, CRLF/LF, auto-detected delimiter) into rows of fields. */
export function parseCSV(text: string, separator?: string): string[][] {
  const sep = separator ?? detectSeparator(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const src = text.replace(/^﻿/, '');
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (ch === '\r' && src[i + 1] === '\n') i++;
    } else field += ch;
    i++;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  // drop trailing blank lines
  while (rows.length && rows[rows.length - 1].every((f) => f === '')) rows.pop();
  return rows;
}

/** Parse CSV into sheet cells starting at A1; data beyond the sheet is dropped (`truncated`). */
export function fromCSV(text: string, separator?: string): { cells: SheetCells; truncated: boolean } {
  const rows = parseCSV(text, separator);
  const cells: SheetCells = {};
  let truncated = false;
  rows.forEach((fields, r) =>
    fields.forEach((f, c) => {
      if (isEmpty(f)) return;
      if (!inBounds(r, c)) {
        truncated = true;
        return;
      }
      cells[cellAddress(r, c)] = f;
    }),
  );
  return { cells, truncated };
}
