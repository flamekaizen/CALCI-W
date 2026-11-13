import { describe, it, expect } from 'vitest';
import { Calculator } from '../src/core/engine';
import {
  evaluateSheet,
  shiftFormula,
  fillDown,
  fillRight,
  fillRange,
  formulaRefs,
  parseAddress,
  columnStats,
  toCSV,
  fromCSV,
  parseCSV,
  SHEET_COLS,
  SHEET_ROWS,
  type SheetCells,
} from '../src/core/spreadsheet';

const v = (cells: SheetCells, addr: string) => evaluateSheet(cells)[addr];
const n = (cells: SheetCells, addr: string) => Number(v(cells, addr)?.value);

describe('spreadsheet: addresses', () => {
  it('parses A1-style addresses within bounds', () => {
    expect(parseAddress('A1')).toEqual({ row: 0, col: 0, colAbs: false, rowAbs: false });
    expect(parseAddress('$h$50')).toEqual({ row: 49, col: 7, colAbs: true, rowAbs: true });
    expect(parseAddress('I1')).toBeNull();
    expect(parseAddress('A51')).toBeNull();
    expect(parseAddress('A0')).toBeNull();
    expect(SHEET_COLS).toBe(8);
    expect(SHEET_ROWS).toBe(50);
  });
});

describe('spreadsheet: literals and formulas', () => {
  it('treats non-formula input as numbers or text', () => {
    const r = evaluateSheet({ A1: '42', A2: '-1.5e2', A3: 'Total', A4: "'123", A5: '   ' });
    expect(r.A1.value).toBe(42);
    expect(r.A2.value).toBe(-150);
    expect(r.A3).toEqual({ value: 'Total', text: 'Total' });
    expect(r.A4.value).toBe('123');
    expect(r.A5).toBeUndefined();
  });

  it('evaluates arithmetic between cells using Calci syntax', () => {
    const cells = { A1: '3', A2: '4', B1: '=sqrt(A1^2 + A2^2)', B2: '=2A1 + 1', B3: '=B1 * 10', C1: '=√16 + |−3|', C2: '=2π' };
    expect(n(cells, 'B1')).toBe(5);
    expect(n(cells, 'B2')).toBe(7);
    expect(n(cells, 'B3')).toBe(50);
    expect(n(cells, 'C1')).toBe(7);
    expect(n(cells, 'C2')).toBeCloseTo(2 * Math.PI, 12);
  });

  it('accepts lowercase and absolute references; empty cells are 0', () => {
    const cells = { A1: '5', B1: '=a1 + $A$1 + $a1 + A$1', B2: '=C9 + 1' };
    expect(n(cells, 'B1')).toBe(20);
    expect(n(cells, 'B2')).toBe(1);
  });

  it('does not mistake numbers, hex literals or identifiers for references', () => {
    const cells = { A1: '1', B1: '=2e1', B2: '=log10(100)', B3: '=atan2(0, 1)', B4: '=0x1A' };
    expect(n(cells, 'B1')).toBe(20);
    expect(n(cells, 'B2')).toBe(2);
    expect(n(cells, 'B3')).toBe(0);
    expect(n(cells, 'B4')).toBe(26);
  });

  it('uses the calculator settings (angle mode, user variables)', () => {
    const calc = new Calculator({ angle: 'deg' });
    calc.evaluate('k = 10');
    const r = evaluateSheet({ A1: '30', B1: '=sin(A1)', B2: '=k*A1' }, { calculator: calc });
    expect(Number(r.B1.value)).toBeCloseTo(0.5, 12);
    expect(r.B2.value).toBe(300);
    // the calculator scope is not modified by sheet formulas
    evaluateSheet({ A1: '=q = 5' }, { calculator: calc });
    expect(calc.scope.has('q')).toBe(false);
  });

  it('evaluates in dependency order regardless of position', () => {
    const cells = { A1: '=A2 + 1', A2: '=A3 * 2', A3: '=H50', H50: '10' };
    expect(n(cells, 'A1')).toBe(21);
  });
});

describe('spreadsheet: ranges and functions', () => {
  const data: SheetCells = { A1: '2', A2: '4', A3: '4', A4: '4', A5: '5', A6: '5', A7: '7', A8: '9', B1: '1', B2: 'label' };

  it('supports range aggregates in any case', () => {
    const cells = {
      ...data,
      C1: '=Sum(A1:A8)',
      C2: '=MEAN(A1:A8)',
      C3: '=min(A1:A8)',
      C4: '=Max(A1:A8)',
      C5: '=Count(A1:A10)',
      C6: '=Median(A1:A8)',
      C7: '=Std(A1:A8)',
      C8: '=Var(A1:A8)',
      C9: '=Product(A1:A3)',
      C10: '=sum(A1:A2, B1:B2, 10)',
      C11: '=Average(A1:A8) + Sum(A1:B1)',
      C12: '=Sum(Sum(A1:A2), A3)',
    };
    const r = evaluateSheet(cells);
    expect(r.C1.value).toBe(40);
    expect(r.C2.value).toBe(5);
    expect(r.C3.value).toBe(2);
    expect(r.C4.value).toBe(9);
    expect(r.C5.value).toBe(8);
    expect(r.C6.value).toBe(4.5);
    expect(Number(r.C7.value)).toBeCloseTo(Math.sqrt(32 / 7), 12); // sample std
    expect(Number(r.C8.value)).toBeCloseTo(32 / 7, 12);
    expect(r.C9.value).toBe(32);
    expect(r.C10.value).toBe(17); // text cells in ranges are skipped
    expect(r.C11.value).toBe(5 + (2 + 1));
    expect(r.C12.value).toBe(10);
  });

  it('handles reversed and two-dimensional ranges', () => {
    const r = evaluateSheet({ A1: '1', B1: '2', A2: '3', B2: '4', C1: '=Sum(B2:A1)', C2: '=Count(A1:B2)' });
    expect(r.C1.value).toBe(10);
    expect(r.C2.value).toBe(4);
  });

  it('reports dependencies for highlighting', () => {
    expect(formulaRefs('=A1 + Sum(B1:B3) + $C$2').sort()).toEqual(['A1', 'B1', 'B2', 'B3', 'C2']);
    expect(formulaRefs('42')).toEqual([]);
  });

  it('computes quick column statistics', () => {
    const s = columnStats(evaluateSheet(data), 0);
    expect(s).toEqual({ count: 8, sum: 40, mean: 5 });
    expect(columnStats(evaluateSheet({}), 2).count).toBe(0);
  });
});

describe('spreadsheet: errors', () => {
  it('detects circular references and propagates them', () => {
    const r = evaluateSheet({ A1: '=A2 + 1', A2: '=A1 * 2', A3: '=A3', B1: '=A1 + 1', B2: '5' });
    expect(r.A1.text).toBe('#CYCLE');
    expect(r.A2.text).toBe('#CYCLE');
    expect(r.A3.text).toBe('#CYCLE');
    expect(r.A1.error).toMatch(/Circular/);
    expect(r.B1.text).toBe('#CYCLE');
    expect(r.B1.error).toMatch(/A1/);
    expect(r.B2.value).toBe(5);
  });

  it('detects cycles through ranges', () => {
    const r = evaluateSheet({ A1: '1', A2: '2', A3: '=Sum(A1:A3)' });
    expect(r.A3.text).toBe('#CYCLE');
  });

  it('reports syntax and unknown-name errors and propagates them', () => {
    const r = evaluateSheet({ A1: '=1 +', A2: '=foo(3)', B1: '=A1 * 2', B2: '=Sum(A1:A2)', C1: '=' });
    expect(r.A1.text).toBe('#ERR');
    expect(r.A1.error).toBeTruthy();
    expect(r.A2.text).toBe('#ERR');
    expect(r.A2.error).toMatch(/foo/);
    expect(r.B1.text).toBe('#ERR');
    expect(r.B1.error).toMatch(/A1/);
    expect(r.B2.text).toBe('#ERR');
    expect(r.C1.text).toBe('#ERR');
  });

  it('flags division by zero and out-of-sheet references', () => {
    const r = evaluateSheet({ A1: '0', B1: '=1/A1', B2: '=A99 + 1', B3: '=#REF! + 1', B4: '=Sum(A1:Z3)', B5: '=B1 + 1' });
    expect(r.B1.text).toBe('#DIV/0');
    expect(r.B2.text).toBe('#REF');
    expect(r.B3.text).toBe('#REF');
    expect(r.B4.text).toBe('#REF');
    expect(r.B5.text).toBe('#DIV/0');
  });

  it('errors on arithmetic with text cells and on empty aggregates', () => {
    const r = evaluateSheet({ A1: 'hello', B1: '=A1 * 2', B2: '=Mean(C1:C5)' });
    expect(r.B1.text).toBe('#ERR');
    expect(r.B2.text).toBe('#ERR');
  });
});

describe('spreadsheet: fill and reference shifting', () => {
  it('shifts relative references and keeps absolute ones', () => {
    expect(shiftFormula('=A1*2', 1, 0)).toBe('=A2*2');
    expect(shiftFormula('=A1*2', 0, 1)).toBe('=B1*2');
    expect(shiftFormula('=$A$1 + A$1 + $A1 + a1', 2, 3)).toBe('=$A$1 + D$1 + $A3 + D3');
    expect(shiftFormula('=Sum(A1:A3) / $B$1', 1, 0)).toBe('=Sum(A2:A4) / $B$1');
    expect(shiftFormula('=log10(A1) + "A1"', 1, 0)).toBe('=log10(A2) + "A1"');
    expect(shiftFormula('42', 5, 5)).toBe('42');
  });

  it('turns references pushed off the sheet into #REF!', () => {
    expect(shiftFormula('=A1 + 1', -1, 0)).toBe('=#REF! + 1');
    expect(shiftFormula('=H1', 0, 1)).toBe('=#REF!');
    expect(evaluateSheet({ A1: shiftFormula('=A1 + 1', -1, 0) }).A1.text).toBe('#REF');
  });

  it('fills down and right', () => {
    let cells: SheetCells = { A1: '1', A2: '2', A3: '3', B1: '=A1*$D$1', D1: '10' };
    cells = fillDown(cells, 'B1', 2);
    expect(cells.B2).toBe('=A2*$D$1');
    expect(cells.B3).toBe('=A3*$D$1');
    const r = evaluateSheet(cells);
    expect([r.B1.value, r.B2.value, r.B3.value]).toEqual([10, 20, 30]);

    cells = fillRight({ A1: '1', B1: '2', A2: '=A1^2' }, 'A2', 1);
    expect(cells.B2).toBe('=B1^2');
    expect(evaluateSheet(cells).B2.value).toBe(4);

    const block = fillRange({ A1: '=ROW', B2: '=A1+1' }, 'B2', 'C3');
    expect(block.C2).toBe('=B1+1');
    expect(block.B3).toBe('=A2+1');
    expect(block.C3).toBe('=B2+1');
    // literals are copied unchanged; filling an empty cell clears the target
    expect(fillDown({ A1: '7' }, 'A1', 2)).toEqual({ A1: '7', A2: '7', A3: '7' });
    expect(fillDown({ A2: 'x' }, 'A1', 1)).toEqual({});
  });
});

describe('spreadsheet: CSV', () => {
  it('round-trips raw inputs including quotes, commas and formulas', () => {
    const cells: SheetCells = { A1: 'Name', B1: 'Value', A2: 'a, "quoted" one', B2: '3', A3: 'line\nbreak', B3: '=Sum(B2:B2, 4)', D4: '1' };
    const csv = toCSV(cells);
    expect(csv.split('\r\n')[0]).toBe('Name,Value,,');
    const back = fromCSV(csv);
    expect(back.truncated).toBe(false);
    expect(back.cells).toEqual(cells);
  });

  it('exports computed values', () => {
    const cells: SheetCells = { A1: '1', A2: '2', A3: '=Sum(A1:A2)/3', B1: '=1/0' };
    expect(toCSV(cells, { mode: 'values' })).toBe('1,#DIV/0\r\n2,\r\n1,');
  });

  it('detects semicolon and tab delimiters and truncates oversize data', () => {
    expect(parseCSV('1;2;3\n4;5;6\n')).toEqual([['1', '2', '3'], ['4', '5', '6']]);
    expect(parseCSV('1\t"a\tb"\r\n2\t3')).toEqual([['1', 'a\tb'], ['2', '3']]);
    const wide = fromCSV(Array.from({ length: 10 }, (_, i) => i).join(','));
    expect(wide.truncated).toBe(true);
    expect(Object.keys(wide.cells)).toHaveLength(SHEET_COLS);
  });
});
