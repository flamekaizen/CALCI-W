import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ArrowDownToLine, ArrowRightToLine, Check, Copy, Download, Eraser, FileUp, Redo2, SquareFunction, Trash2, Undo2, X } from 'lucide-react';
import { getCalculator } from '../engine';
import { useStore } from '../store';
import { Segmented, Tabs, copyText, fmt, toast } from '../ui';
import {
  COLUMN_LETTERS,
  SHEET_COLS,
  SHEET_FUNCTIONS,
  SHEET_ROWS,
  cellAddress,
  evaluateSheet,
  fillRange,
  formulaRefs,
  fromCSV,
  isFormula,
  parseCSV,
  rangeStats,
  shiftFormula,
  toCSV,
  usedBounds,
  type CellResult,
  type SheetCells,
  type SheetResults,
} from '../../core/spreadsheet';
import '../../styles/modes/spreadsheet.css';

const STORE_KEY = 'calci-sheet-v1';

const EXAMPLE: SheetCells = {
  A1: 'x',
  B1: 'x²',
  C1: 'Share',
  A2: '12',
  A3: '15',
  A4: '9',
  A5: '21',
  A6: '18',
  B2: '=A2^2',
  B3: '=A3^2',
  B4: '=A4^2',
  B5: '=A5^2',
  B6: '=A6^2',
  C2: '=A2/$A$8',
  C3: '=A3/$A$8',
  C4: '=A4/$A$8',
  C5: '=A5/$A$8',
  C6: '=A6/$A$8',
  A8: '=Sum(A2:A6)',
  B8: '=Sum(B2:B6)',
  A9: '=Mean(A2:A6)',
  B9: '=Std(A2:A6)',
};

function load(): SheetCells {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw === null) return EXAMPLE;
    const v = JSON.parse(raw);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const out: SheetCells = {};
      for (const [k, s] of Object.entries(v)) if (typeof s === 'string' && /^[A-Z]\d+$/.test(k)) out[k] = s;
      return out;
    }
  } catch {
    /* ignore */
  }
  return EXAMPLE;
}

interface Pos {
  r: number;
  c: number;
}
interface Doc {
  cells: SheetCells;
  past: SheetCells[];
  future: SheetCells[];
}
interface Editing {
  /** 'enter': started by typing (arrows commit and move); 'edit': F2 / double-click / formula bar (arrows move the caret). */
  mode: 'enter' | 'edit';
  where: 'cell' | 'bar';
}
type FillDir = 'down' | 'right';

const clampR = (r: number) => Math.max(0, Math.min(SHEET_ROWS - 1, r));
const clampC = (c: number) => Math.max(0, Math.min(SHEET_COLS - 1, c));
const cellId = (r: number, c: number) => `sps-cell-${cellAddress(r, c)}`;
const isNumericValue = (v: unknown) => typeof v === 'number' || !!(v as any)?.isBigNumber || !!(v as any)?.isFraction;
/** Characters after which clicking a cell inserts its reference into the formula being typed. */
const POINTABLE = /[=+\-*/^(,:<>;%!&|?]$/;

export default function Spreadsheet() {
  const [doc, setDoc] = useState<Doc>(() => ({ cells: load(), past: [], future: [] }));
  const cells = doc.cells;
  const [sel, setSel] = useState<Pos>({ r: 0, c: 0 });
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 0 });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState('');
  const [fill, setFill] = useState<{ dir: FillDir; to: number } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);

  const gridRef = useRef<HTMLTableElement>(null);
  const cellEditorRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLInputElement>(null);
  const editingRef = useRef<Editing | null>(null);
  editingRef.current = editing;
  const draftRef = useRef('');
  draftRef.current = draft;
  const pointRef = useRef<{ start: number; end: number } | null>(null);
  const suppressBlur = useRef(false);
  const dragging = useRef(false);
  const pointerType = useRef('mouse');
  const clip = useRef<{ text: string; raws: string[][]; origin: Pos } | null>(null);

  // recompute when calculator preferences or the user library change
  const calcPrefs = useStore((s) => s.calc);
  const library = useStore((s) => s.library);
  const results = useMemo(() => evaluateSheet(cells, { calculator: getCalculator() }), [cells, calcPrefs, library]);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(cells));
    } catch {
      /* ignore */
    }
  }, [cells]);

  /* ---------------------------------------------------------------- doc ops */
  const apply = useCallback((fn: (c: SheetCells) => SheetCells) => {
    setDoc((d) => {
      const next = fn(d.cells);
      if (next === d.cells) return d;
      return { cells: next, past: [...d.past.slice(-99), d.cells], future: [] };
    });
  }, []);
  const undo = () => setDoc((d) => (d.past.length ? { cells: d.past[d.past.length - 1], past: d.past.slice(0, -1), future: [d.cells, ...d.future] } : d));
  const redo = () => setDoc((d) => (d.future.length ? { cells: d.future[0], past: [...d.past, d.cells], future: d.future.slice(1) } : d));

  const setRaw = (map: SheetCells, addr: string, raw: string) => {
    if (raw.trim()) map[addr] = raw;
    else delete map[addr];
  };

  /* ---------------------------------------------------------------- selection */
  const rect = {
    r0: Math.min(anchor.r, sel.r),
    r1: Math.max(anchor.r, sel.r),
    c0: Math.min(anchor.c, sel.c),
    c1: Math.max(anchor.c, sel.c),
  };
  const isRange = rect.r0 !== rect.r1 || rect.c0 !== rect.c1;
  const selAddr = cellAddress(sel.r, sel.c);
  const selLabel = isRange ? `${cellAddress(rect.r0, rect.c0)}:${cellAddress(rect.r1, rect.c1)}` : selAddr;

  const focusGrid = () => gridRef.current?.focus({ preventScroll: true });

  const select = (p: Pos, extend = false) => {
    const q = { r: clampR(p.r), c: clampC(p.c) };
    setSel(q);
    if (!extend) setAnchor(q);
  };

  useEffect(() => {
    document.getElementById(cellId(sel.r, sel.c))?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [sel]);

  /* ---------------------------------------------------------------- editing */
  const startEdit = (mode: Editing['mode'], where: Editing['where'], initial?: string) => {
    setDraft(initial ?? cells[selAddr] ?? '');
    setEditing({ mode, where });
    pointRef.current = null;
    setFill(null);
  };

  const commit = (move?: Pos) => {
    const ed = editingRef.current;
    if (!ed) return;
    const raw = draftRef.current;
    editingRef.current = null;
    setEditing(null);
    pointRef.current = null;
    if ((cells[selAddr] ?? '') !== raw) {
      apply((c) => {
        const n = { ...c };
        setRaw(n, selAddr, raw);
        return n;
      });
    }
    if (move) select({ r: sel.r + move.r, c: sel.c + move.c });
    focusGrid();
  };

  const cancel = () => {
    editingRef.current = null;
    setEditing(null);
    pointRef.current = null;
    focusGrid();
  };

  // focus the in-cell editor when it opens (caret at the end)
  useEffect(() => {
    if (editing?.where !== 'cell') return;
    const el = cellEditorRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const n = el.value.length;
    el.setSelectionRange(n, n);
  }, [editing]);

  const activeEditor = () => (editing?.where === 'bar' ? barRef.current : cellEditorRef.current);

  /** Point mode: insert (or replace the just-inserted) reference at the caret. Returns true when handled. */
  const tryPoint = (r: number, c: number, extendRange: boolean): boolean => {
    if (!editing || !draft.trimStart().startsWith('=')) return false;
    const el = activeEditor();
    if (!el) return false;
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? start;
    const ref = cellAddress(r, c);
    const prev = pointRef.current;
    let from: number;
    let to: number;
    let text = ref;
    if (prev && prev.end === start && start === end) {
      from = prev.start;
      to = prev.end;
      if (extendRange) {
        const existing = draft.slice(prev.start, prev.end).split(':')[0];
        text = `${existing}:${ref}`;
      }
    } else if (POINTABLE.test(draft.slice(0, start).trimEnd())) {
      from = start;
      to = end;
    } else return false;
    const next = draft.slice(0, from) + text + draft.slice(to);
    setDraft(next);
    pointRef.current = { start: from, end: from + text.length };
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      el.setSelectionRange(from + text.length, from + text.length);
    });
    return true;
  };

  /* ---------------------------------------------------------------- fill / clear */
  /** Default fill target: as far as the data next to the selection goes (like double-clicking a fill handle). */
  const fillAuto = (dir: FillDir): number => {
    if (dir === 'down') {
      for (const nc of [rect.c0 - 1, rect.c1 + 1]) {
        if (nc < 0 || nc >= SHEET_COLS) continue;
        let k = rect.r0;
        while (k + 1 < SHEET_ROWS && (cells[cellAddress(k + 1, nc)] ?? '').trim()) k++;
        if (k > rect.r0) return k;
      }
      return clampR(rect.r0 + 4);
    }
    for (const nr of [rect.r0 - 1, rect.r1 + 1]) {
      if (nr < 0 || nr >= SHEET_ROWS) continue;
      let k = rect.c0;
      while (k + 1 < SHEET_COLS && (cells[cellAddress(nr, k + 1)] ?? '').trim()) k++;
      if (k > rect.c0) return k;
    }
    return clampC(rect.c0 + 1);
  };

  /** Copy the selection's top row (down) or left column (right) out to `to`, shifting relative references. */
  const doFill = (dir: FillDir, to: number) => {
    if (dir === 'down') {
      if (to <= rect.r0) return;
      apply((c) => {
        let n = c;
        for (let col = rect.c0; col <= rect.c1; col++) n = fillRange(n, cellAddress(rect.r0, col), cellAddress(to, col));
        return n;
      });
      toast(`Filled down to row ${to + 1}`);
    } else {
      if (to <= rect.c0) return;
      apply((c) => {
        let n = c;
        for (let row = rect.r0; row <= rect.r1; row++) n = fillRange(n, cellAddress(row, rect.c0), cellAddress(row, to));
        return n;
      });
      toast(`Filled right to column ${COLUMN_LETTERS[to]}`);
    }
    setFill(null);
    focusGrid();
  };

  /** Fill straight away when a range is selected along the fill direction; otherwise ask how far. */
  const requestFill = (dir: FillDir) => {
    if (editingRef.current) commit();
    if (dir === 'down' ? rect.r1 > rect.r0 : rect.c1 > rect.c0) doFill(dir, dir === 'down' ? rect.r1 : rect.c1);
    else if (dir === 'down' ? rect.r0 >= SHEET_ROWS - 1 : rect.c0 >= SHEET_COLS - 1) toast('Nothing to fill into');
    else setFill({ dir, to: fillAuto(dir) });
  };

  const clearSelection = () => {
    apply((c) => {
      const n = { ...c };
      let changed = false;
      for (let r = rect.r0; r <= rect.r1; r++)
        for (let col = rect.c0; col <= rect.c1; col++) {
          const a = cellAddress(r, col);
          if (a in n) {
            delete n[a];
            changed = true;
          }
        }
      return changed ? n : c;
    });
  };

  const usedCount = Object.keys(cells).length;
  const clearAll = () => {
    apply((c) => (Object.keys(c).length ? {} : c));
    setConfirmClear(false);
    select({ r: 0, c: 0 });
    toast('Sheet cleared · Undo with Ctrl+Z');
    focusGrid();
  };

  /* ---------------------------------------------------------------- clipboard */
  useEffect(() => {
    const active = () => document.activeElement === gridRef.current && !editingRef.current;
    const toClip = () => {
      const raws: string[][] = [];
      const lines: string[] = [];
      for (let r = rect.r0; r <= rect.r1; r++) {
        const rowRaw: string[] = [];
        const rowVal: string[] = [];
        for (let c = rect.c0; c <= rect.c1; c++) {
          const a = cellAddress(r, c);
          rowRaw.push(cells[a] ?? '');
          const res = results[a];
          rowVal.push(res ? (typeof res.value === 'number' && !res.error ? String(res.value) : res.text) : '');
        }
        raws.push(rowRaw);
        lines.push(rowVal.join('\t'));
      }
      const text = lines.join('\n');
      clip.current = { text, raws, origin: { r: rect.r0, c: rect.c0 } };
      return text;
    };
    const onCopy = (e: ClipboardEvent) => {
      if (!active() || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', toClip());
      toast(`Copied ${selLabel}`);
    };
    const onCut = (e: ClipboardEvent) => {
      if (!active() || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', toClip());
      clearSelection();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!active() || !e.clipboardData) return;
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      if (!text) return;
      const own = clip.current && clip.current.text === text.replace(/\r\n/g, '\n') ? clip.current : null;
      const grid = own ? own.raws : parseCSV(text, text.includes('\t') ? '\t' : undefined);
      const dr = own ? rect.r0 - own.origin.r : 0;
      const dc = own ? rect.c0 - own.origin.c : 0;
      let skipped = false;
      apply((c) => {
        const n = { ...c };
        grid.forEach((row, i) =>
          row.forEach((raw, j) => {
            const r = rect.r0 + i;
            const col = rect.c0 + j;
            if (r >= SHEET_ROWS || col >= SHEET_COLS) {
              skipped = true;
              return;
            }
            setRaw(n, cellAddress(r, col), own ? shiftFormula(raw, dr, dc) : raw);
          }),
        );
        return n;
      });
      const h = Math.min(grid.length, SHEET_ROWS - rect.r0);
      const w = Math.min(Math.max(0, ...grid.map((r) => r.length)), SHEET_COLS - rect.c0);
      if (h > 0 && w > 0) {
        setAnchor({ r: rect.r0, c: rect.c0 });
        setSel({ r: rect.r0 + h - 1, c: rect.c0 + w - 1 });
      }
      if (skipped) toast('Some pasted cells were outside the sheet');
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  });

  /* ---------------------------------------------------------------- keyboard */
  const onGridKey = (e: ReactKeyboardEvent<HTMLTableElement>) => {
    if (editing) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const move = (dr: number, dc: number) => {
      e.preventDefault();
      select({ r: sel.r + dr, c: sel.c + dc }, e.shiftKey);
    };
    if (mod && (k === 'z' || k === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && (k === 'y' || k === 'Y')) {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && (k === 'd' || k === 'D')) {
      e.preventDefault();
      requestFill('down');
      return;
    }
    if (mod && (k === 'r' || k === 'R')) {
      e.preventDefault();
      requestFill('right');
      return;
    }
    if (mod && (k === 'a' || k === 'A')) {
      e.preventDefault();
      setAnchor({ r: 0, c: 0 });
      setSel({ r: SHEET_ROWS - 1, c: SHEET_COLS - 1 });
      return;
    }
    switch (k) {
      case 'ArrowUp':
        return mod ? move(-sel.r, 0) : move(-1, 0);
      case 'ArrowDown':
        return mod ? move(SHEET_ROWS - 1 - sel.r, 0) : move(1, 0);
      case 'ArrowLeft':
        return mod ? move(0, -sel.c) : move(0, -1);
      case 'ArrowRight':
        return mod ? move(0, SHEET_COLS - 1 - sel.c) : move(0, 1);
      case 'PageUp':
        return move(-10, 0);
      case 'PageDown':
        return move(10, 0);
      case 'Home':
        return mod ? (e.preventDefault(), select({ r: 0, c: 0 })) : move(0, -sel.c);
      case 'End':
        return move(0, SHEET_COLS - 1 - sel.c);
      case 'Tab': {
        const dc = e.shiftKey ? -1 : 1;
        if (sel.c + dc < 0 || sel.c + dc >= SHEET_COLS) return; // let focus leave the grid
        e.preventDefault();
        select({ r: sel.r, c: sel.c + dc });
        return;
      }
      case 'Enter':
      case 'F2':
        e.preventDefault();
        startEdit('edit', 'cell');
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        clearSelection();
        return;
      case 'Escape':
        if (isRange) {
          e.preventDefault();
          setAnchor(sel);
        }
        return;
    }
    if (k.length === 1 && !mod && !e.altKey) {
      e.preventDefault();
      setAnchor(sel);
      startEdit('enter', 'cell', k);
    }
  };

  const onEditorKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    const k = e.key;
    if (k === 'Enter') {
      e.preventDefault();
      commit({ r: e.shiftKey ? -1 : 1, c: 0 });
    } else if (k === 'Tab') {
      e.preventDefault();
      commit({ r: 0, c: e.shiftKey ? -1 : 1 });
    } else if (k === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (editing?.mode === 'enter' && editing.where === 'cell' && k.startsWith('Arrow') && !e.shiftKey) {
      e.preventDefault();
      commit({ r: k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0, c: k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0 });
    } else if (k.length === 1 || k === 'Backspace' || k === 'Delete') {
      pointRef.current = null;
    }
  };

  const onEditorBlur = (e: ReactFocusEvent<HTMLInputElement>) => {
    if (suppressBlur.current) return;
    const ed = editingRef.current;
    if (!ed) return;
    if (ed.where === 'cell' && e.relatedTarget === barRef.current) {
      // moving from the in-cell editor to the formula bar keeps the draft
      const next: Editing = { mode: 'edit', where: 'bar' };
      editingRef.current = next;
      setEditing(next);
      return;
    }
    commit();
  };

  /* ---------------------------------------------------------------- pointer */
  const onCellPointerDown = (e: ReactPointerEvent<HTMLTableCellElement>, r: number, c: number) => {
    pointerType.current = e.pointerType;
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (editing) {
      if (tryPoint(r, c, e.shiftKey)) {
        e.preventDefault();
        suppressBlur.current = true;
        requestAnimationFrame(() => {
          suppressBlur.current = false;
        });
        return;
      }
      commit();
    }
    const again = !e.shiftKey && sel.r === r && sel.c === c && !isRange;
    select({ r, c }, e.shiftKey);
    if (e.pointerType === 'mouse') {
      dragging.current = true;
      e.preventDefault();
      focusGrid();
    } else if (again && !editing) {
      // touch / pen: tapping the selected cell again opens the editor (and the keyboard)
      e.preventDefault();
      startEdit('edit', 'cell');
    }
  };
  const onCellPointerEnter = (r: number, c: number) => {
    if (dragging.current && !editing) select({ r, c }, true);
  };
  useEffect(() => {
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  /* ---------------------------------------------------------------- derived display */
  const highlight = useMemo(() => {
    const raw = editing ? draft : cells[selAddr] ?? '';
    return new Set(formulaRefs(raw));
  }, [editing, draft, cells, selAddr]);

  const selRes: CellResult | undefined = results[selAddr];
  const stats = isRange ? rangeStats(results, { row: rect.r0, col: rect.c0 }, { row: rect.r1, col: rect.c1 }) : rangeStats(results, { row: 0, col: sel.c }, { row: SHEET_ROWS - 1, col: sel.c });
  const statsLabel = isRange ? `Selection ${selLabel}` : `Column ${COLUMN_LETTERS[sel.c]}`;
  const barValue = editing ? draft : cells[selAddr] ?? '';

  return (
    <div className="page wide sps-page">
      <section className="card sps-card">
        {/* formula bar */}
        <div className="sps-bar">
          <span className="sps-addr mono" aria-label={`Selected ${isRange ? 'range' : 'cell'} ${selLabel}`} title="Selected cell">
            {selLabel}
          </span>
          <SquareFunction size={16} className="sps-fx" aria-hidden />
          <input
            ref={barRef}
            className="input mono sps-bar-input"
            value={barValue}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label={`Contents of ${selAddr}`}
            placeholder="Value, text or =formula"
            onFocus={() => {
              if (!editingRef.current) startEdit('edit', 'bar');
            }}
            onChange={(e) => {
              if (!editing) startEdit('edit', 'bar', e.target.value);
              else setDraft(e.target.value);
              pointRef.current = null;
            }}
            onKeyDown={onEditorKey}
            onBlur={onEditorBlur}
          />
          {editing && (
            <span className="row nowrap sps-bar-actions">
              <button
                type="button"
                className="icon-btn sps-touch"
                aria-label="Cancel edit"
                title="Cancel (Esc)"
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={cancel}
              >
                <X size={16} />
              </button>
              <button
                type="button"
                className="icon-btn sps-touch sps-accept"
                aria-label="Confirm edit"
                title="Confirm (Enter)"
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit()}
              >
                <Check size={16} />
              </button>
            </span>
          )}
        </div>
        <div className={`sps-status small${selRes?.error ? ' err' : ''}`} aria-live="polite">
          {selRes?.error ? (
            <>
              <strong>{selRes.text}</strong> {selRes.error}
            </>
          ) : selRes && isFormula(cells[selAddr]) ? (
            <>
              <span className="muted">{selAddr} =</span> <span className="mono">{selRes.text}</span>
            </>
          ) : (
            <span className="muted">{editing ? 'Enter to confirm · Esc to cancel · tap a cell to insert its reference' : 'Type to edit · Enter or F2 to edit in place'}</span>
          )}
        </div>

        {/* toolbar */}
        <div className="sps-toolbar" role="toolbar" aria-label="Spreadsheet actions">
          <button type="button" className="icon-btn sps-touch" onClick={undo} disabled={!doc.past.length} aria-label="Undo" title="Undo (Ctrl+Z)">
            <Undo2 size={16} />
          </button>
          <button type="button" className="icon-btn sps-touch" onClick={redo} disabled={!doc.future.length} aria-label="Redo" title="Redo (Ctrl+Y)">
            <Redo2 size={16} />
          </button>
          <span className="sps-sep" aria-hidden />
          <button type="button" className="btn btn-ghost btn-sm sps-touch" onClick={() => requestFill('down')} title="Fill down (Ctrl+D)">
            <ArrowDownToLine size={15} /> <span className="sps-btn-label">Fill down</span>
          </button>
          <button type="button" className="btn btn-ghost btn-sm sps-touch" onClick={() => requestFill('right')} title="Fill right (Ctrl+R)">
            <ArrowRightToLine size={15} /> <span className="sps-btn-label">Fill right</span>
          </button>
          <button type="button" className="btn btn-ghost btn-sm sps-touch" onClick={clearSelection} title="Clear (Delete)" aria-label={`Clear ${selLabel}`}>
            <Eraser size={15} /> <span className="sps-btn-label">Clear</span>
          </button>
          <span className="sps-sep" aria-hidden />
          <button type="button" className="btn btn-ghost btn-sm sps-touch" onClick={() => setCsvOpen(true)} title="Import or export CSV">
            <FileUp size={15} /> <span className="sps-btn-label">CSV</span>
          </button>
          <div className="spacer" />
          {confirmClear ? (
            <span className="row nowrap sps-confirm" role="group" aria-label="Confirm clear all">
              <span className="small">Clear all {usedCount} cells?</span>
              <button type="button" className="btn btn-sm btn-danger sps-touch" onClick={clearAll} autoFocus>
                Clear all
              </button>
              <button type="button" className="btn btn-sm btn-ghost sps-touch" onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm sps-touch" onClick={() => setConfirmClear(true)} disabled={!usedCount} title="Clear the whole sheet">
              <Trash2 size={15} /> <span className="sps-btn-label">Clear all</span>
            </button>
          )}
        </div>

        {fill && (
          <FillBar
            dir={fill.dir}
            from={
              !isRange
                ? selAddr
                : fill.dir === 'down'
                  ? `${cellAddress(rect.r0, rect.c0)}:${cellAddress(rect.r0, rect.c1)}`
                  : `${cellAddress(rect.r0, rect.c0)}:${cellAddress(rect.r1, rect.c0)}`
            }
            min={fill.dir === 'down' ? rect.r0 + 1 : rect.c0 + 1}
            value={fill.to}
            onChange={(to) => setFill({ ...fill, to })}
            onApply={() => doFill(fill.dir, fill.to)}
            onCancel={() => {
              setFill(null);
              focusGrid();
            }}
          />
        )}

        {/* grid */}
        <div className="sps-scroll">
          <table
            ref={gridRef}
            className="sps-grid"
            role="grid"
            aria-label="Spreadsheet"
            aria-rowcount={SHEET_ROWS + 1}
            aria-colcount={SHEET_COLS + 1}
            aria-multiselectable="true"
            aria-activedescendant={editing?.where === 'cell' ? undefined : cellId(sel.r, sel.c)}
            tabIndex={0}
            onKeyDown={onGridKey}
          >
            <thead>
              <tr role="row">
                <th className="sps-corner" role="columnheader" aria-label="Row and column headers" />
                {COLUMN_LETTERS.map((L, c) => (
                  <th
                    key={L}
                    role="columnheader"
                    scope="col"
                    className={c >= rect.c0 && c <= rect.c1 ? 'on' : ''}
                    onPointerDown={(e) => {
                      if (editing) return;
                      e.preventDefault();
                      setAnchor({ r: 0, c: e.shiftKey ? anchor.c : c });
                      setSel({ r: SHEET_ROWS - 1, c });
                      focusGrid();
                    }}
                  >
                    {L}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: SHEET_ROWS }, (_, r) => (
                <tr key={r} role="row">
                  <th
                    role="rowheader"
                    scope="row"
                    className={r >= rect.r0 && r <= rect.r1 ? 'on' : ''}
                    onPointerDown={(e) => {
                      if (editing) return;
                      e.preventDefault();
                      setAnchor({ r: e.shiftKey ? anchor.r : r, c: 0 });
                      setSel({ r, c: SHEET_COLS - 1 });
                      focusGrid();
                    }}
                  >
                    {r + 1}
                  </th>
                  {COLUMN_LETTERS.map((L, c) => {
                    const addr = `${L}${r + 1}`;
                    const raw = cells[addr];
                    const res = results[addr];
                    const active = r === sel.r && c === sel.c;
                    const inRange = r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1;
                    const editingHere = active && editing?.where === 'cell';
                    const showDraft = active && editing?.where === 'bar';
                    const cls = [
                      'sps-cell',
                      active ? 'active' : '',
                      inRange && isRange ? 'in-range' : '',
                      highlight.has(addr) ? 'ref' : '',
                      res?.error ? 'err' : res && isNumericValue(res.value) ? 'num' : '',
                      isFormula(raw) ? 'formula' : '',
                      editingHere ? 'editing' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    const label = `${addr}${res ? `, ${res.text}` : ', empty'}${isFormula(raw) ? `, formula ${raw}` : ''}${res?.error ? `, ${res.error}` : ''}`;
                    return (
                      <td
                        key={L}
                        id={cellId(r, c)}
                        role="gridcell"
                        aria-selected={inRange}
                        aria-label={label}
                        className={cls}
                        title={res?.error ? `${res.text}: ${res.error}` : isFormula(raw) ? raw : undefined}
                        onPointerDown={(e) => onCellPointerDown(e, r, c)}
                        onPointerEnter={() => onCellPointerEnter(r, c)}
                        onDoubleClick={() => {
                          if (pointerType.current === 'mouse' && !editing) startEdit('edit', 'cell');
                        }}
                      >
                        {editingHere ? (
                          <input
                            ref={cellEditorRef}
                            className="sps-editor mono"
                            value={draft}
                            style={{ width: `max(100%, ${draft.length + 3}ch)` }}
                            spellCheck={false}
                            autoCapitalize="off"
                            autoCorrect="off"
                            aria-label={`Edit ${addr}`}
                            onChange={(e) => {
                              setDraft(e.target.value);
                              pointRef.current = null;
                            }}
                            onKeyDown={onEditorKey}
                            onBlur={onEditorBlur}
                          />
                        ) : (
                          <span className="sps-text">{showDraft ? draft : res?.text ?? ''}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* quick stats */}
        <div className="sps-stats" aria-label={`Statistics for ${statsLabel}`}>
          <span className="sps-stats-label">{statsLabel}</span>
          <span className="sps-stat">
            <span className="k">Count</span> <span className="v">{stats.count}</span>
          </span>
          <span className="sps-stat">
            <span className="k">Sum</span> <span className="v">{stats.count ? fmt(stats.sum) : '—'}</span>
          </span>
          <span className="sps-stat">
            <span className="k">Mean</span> <span className="v">{fmt(stats.mean)}</span>
          </span>
        </div>
      </section>

      <p className="sps-help small muted">
        Start a formula with <code>=</code>. Refer to cells as <code>A1</code> or <code>$A$1</code> (absolute) and ranges as <code>A1:B10</code>. Range functions (any case):{' '}
        {SHEET_FUNCTIONS.join(', ')} — plus every Calci function such as sqrt, sin, log, nCr. While typing a formula, click or tap a cell to insert its reference. Shortcuts:
        Shift+arrows select, Ctrl+D / Ctrl+R fill, Ctrl+C / Ctrl+V copy and paste, Ctrl+Z undo.
      </p>

      {csvOpen && (
        <CsvDialog
          cells={cells}
          results={results}
          onImport={(next) => {
            apply(() => next);
            select({ r: 0, c: 0 });
          }}
          onClose={() => {
            setCsvOpen(false);
            focusGrid();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ fill bar */
function FillBar({
  dir, from, min, value, onChange, onApply, onCancel,
}: {
  dir: FillDir;
  from: string;
  min: number;
  value: number;
  onChange: (to: number) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const options = dir === 'down' ? Array.from({ length: SHEET_ROWS - min }, (_, i) => min + i) : Array.from({ length: SHEET_COLS - min }, (_, i) => min + i);
  return (
    <div className="sps-fill" role="group" aria-label={`Fill ${from} ${dir}`}>
      <span className="small">
        Fill <strong className="mono">{from}</strong> {dir === 'down' ? 'down to row' : 'right to column'}
      </span>
      <select
        className="select sps-fill-select sps-touch"
        value={value}
        autoFocus
        aria-label={dir === 'down' ? 'Last row to fill' : 'Last column to fill'}
        onChange={(e) => onChange(Number(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onApply();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      >
        {options.map((i) => (
          <option key={i} value={i}>
            {dir === 'down' ? i + 1 : COLUMN_LETTERS[i]}
          </option>
        ))}
      </select>
      <button type="button" className="btn btn-primary btn-sm sps-touch" onClick={onApply}>
        Fill
      </button>
      <button type="button" className="btn btn-ghost btn-sm sps-touch" onClick={onCancel}>
        Cancel
      </button>
      <span className="small muted">Relative references shift; $-anchored ones stay.</span>
    </div>
  );
}

/* ------------------------------------------------------------------ CSV dialog */
function CsvDialog({
  cells, results, onImport, onClose,
}: {
  cells: SheetCells;
  results: SheetResults;
  onImport: (cells: SheetCells) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'import' | 'export'>('import');
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'values' | 'raw'>('values');
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const csv = useMemo(() => toCSV(cells, { mode, results }), [cells, mode, results]);
  const { rows, cols } = usedBounds(cells);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    dialogRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const doImport = () => {
    if (!text.trim()) {
      toast('Paste some CSV first');
      return;
    }
    const { cells: next, truncated } = fromCSV(text);
    const n = Object.keys(next).length;
    if (!n) {
      toast('No cells found');
      return;
    }
    onImport(next);
    toast(truncated ? `Imported ${n} cells · data outside A1:${cellAddress(SHEET_ROWS - 1, SHEET_COLS - 1)} was skipped` : `Imported ${n} cells`);
    onClose();
  };

  const download = () => {
    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = mode === 'raw' ? 'calci-sheet-formulas.csv' : 'calci-sheet.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('CSV downloaded');
    } catch {
      toast('Download failed — use Copy instead');
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div ref={dialogRef} className="dialog sps-dialog" role="dialog" aria-modal="true" aria-labelledby="sps-csv-title" onClick={(e) => e.stopPropagation()}>
        <div className="card-header">
          <h3 id="sps-csv-title">CSV</h3>
          <div className="spacer" />
          <button type="button" className="icon-btn sps-touch" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="card-body stack sps-dialog-body">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'import', label: 'Import' },
              { id: 'export', label: 'Export' },
            ]}
          />
          {tab === 'import' ? (
            <div className="stack-sm">
              <label className="label" htmlFor="sps-csv-in">
                Paste CSV (comma, semicolon or tab separated). It replaces the sheet, starting at A1 — Undo restores it.
              </label>
              <textarea
                id="sps-csv-in"
                className="textarea mono"
                rows={8}
                value={text}
                spellCheck={false}
                onChange={(e) => setText(e.target.value)}
                placeholder={'x,y\n1,2.5\n2,=A3*3'}
              />
              <div className="row">
                <button type="button" className="btn btn-primary sps-touch" onClick={doImport}>
                  <FileUp size={15} /> Replace sheet
                </button>
                <button type="button" className="btn btn-ghost sps-touch" onClick={() => fileRef.current?.click()}>
                  Choose file…
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/plain"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      setText(await f.text());
                    } catch {
                      toast('Could not read the file');
                    }
                    e.target.value = '';
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="stack-sm">
              <div className="row">
                <Segmented
                  size="sm"
                  ariaLabel="Export contents"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'values', label: 'Values', title: 'Computed results' },
                    { value: 'raw', label: 'Formulas', title: 'Raw inputs; re-importable' },
                  ]}
                />
                <span className="small muted">{rows ? `${rows} × ${cols} cells` : 'The sheet is empty'}</span>
              </div>
              <textarea className="textarea mono" rows={8} value={csv} readOnly aria-label="CSV preview" />
              <div className="row">
                <button type="button" className="btn btn-primary sps-touch" onClick={download} disabled={!rows}>
                  <Download size={15} /> Download .csv
                </button>
                <button type="button" className="btn btn-ghost sps-touch" onClick={() => copyText(csv, 'CSV copied')} disabled={!rows}>
                  <Copy size={15} /> Copy
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
