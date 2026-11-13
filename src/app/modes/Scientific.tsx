import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Copy, History, X, Delete, ChevronLeft, ChevronRight, Keyboard } from 'lucide-react';
import { getCalculator } from '../engine';
import { useStore, type HistoryEntry } from '../store';
import { Tex, copyText, haptic, useMediaQuery, NumberInput, toast } from '../ui';
import { FN_DOCS, signatureAt } from '../fnDocs';
import { emitEmbed } from '../../embed/bridge';
import { latexToExpr, alternativeForms, type EvalResult } from '../../core/index';
import { MathInput, type MathInputHandle } from '../components/MathInput';
import { SidePanel, SigHelp } from './ScientificPanel';
import '../../styles/modes/scientific.css';

type Action = 'eval' | 'clear' | 'back' | 'shift' | 'left' | 'right' | 'mplus' | 'mminus' | 'mr' | 'mc' | 'angle' | 'sd';
interface Key {
  label: ReactNode;
  /** Linear (one-line) text to insert */
  insert?: string;
  /** Textbook LaTeX template to insert (#? = empty box, #@ = previous term) */
  latex?: string;
  action?: Action;
  cls?: 'num' | 'fn' | 'op' | 'eq' | 'act' | 'mem';
  title?: string;
  shift?: Key;
  wide?: boolean;
}

const k = (label: ReactNode, insert: string, latex: string, cls: Key['cls'] = 'fn', title?: string, shift?: Key): Key => ({ label, insert, latex, cls, title, shift });
const sup = (base: string, s: string) => (
  <span>
    {base}
    <sup>{s}</sup>
  </span>
);
const FracIcon = ({ mixed = false }: { mixed?: boolean }) => (
  <span className="key-frac" aria-hidden>
    {mixed && <span className="key-frac-whole">▫</span>}
    <span className="key-frac-stack">
      <span>▫</span>
      <span className="key-frac-bar" />
      <span>▫</span>
    </span>
  </span>
);

const FN_KEYS: Key[] = [
  { label: '2nd', action: 'shift', cls: 'act', title: 'Second function (yellow labels)' },
  { label: 'DEG', action: 'angle', cls: 'act', title: 'Cycle angle unit' },
  k(<FracIcon />, '/', '\\frac{#@}{#?}', 'fn', 'Fraction — numerator over denominator', k(<FracIcon mixed />, ' ', '#?\\frac{#?}{#?}', 'fn', 'Mixed number')),
  k('√', '√(', '\\sqrt{#?}', 'fn', 'Square root', k('∛', 'cbrt(', '\\sqrt[3]{#?}', 'fn', 'Cube root')),
  k(sup('x', '▫'), '^', '^{#?}', 'fn', 'Power', k(<span>ⁿ√</span>, 'root(', '\\sqrt[#?]{#?}', 'fn', 'n-th root')),
  k(sup('x', '2'), '^2', '^{2}', 'fn', 'Square', k(sup('x', '3'), '^3', '^{3}', 'fn', 'Cube')),
  k(sup('x', '−1'), '^(-1)', '^{-1}', 'fn', 'Reciprocal', k('|x|', 'abs(', '\\left|#?\\right|', 'fn', 'Absolute value')),
  k('log', 'log(', '\\log\\left(#?\\right)', 'fn', 'Log base 10', k(sup('10', '▫'), '10^(', '10^{#?}', 'fn', 'Power of ten')),
  k(<span>log<sub>▫</sub></span>, 'log(', '\\log_{#?}\\left(#?\\right)', 'fn', 'Logarithm in any base', k('log₂', 'log2(', '\\log_{2}\\left(#?\\right)', 'fn', 'Log base 2')),
  k('ln', 'ln(', '\\ln\\left(#?\\right)', 'fn', 'Natural log', k(sup('e', '▫'), 'e^(', 'e^{#?}', 'fn', 'Exponential')),
  k('sin', 'sin(', '\\sin\\left(#?\\right)', 'fn', 'Sine', k(sup('sin', '−1'), 'asin(', '\\sin^{-1}\\left(#?\\right)', 'fn', 'Inverse sine')),
  k('cos', 'cos(', '\\cos\\left(#?\\right)', 'fn', 'Cosine', k(sup('cos', '−1'), 'acos(', '\\cos^{-1}\\left(#?\\right)', 'fn', 'Inverse cosine')),
  k('tan', 'tan(', '\\tan\\left(#?\\right)', 'fn', 'Tangent', k(sup('tan', '−1'), 'atan(', '\\tan^{-1}\\left(#?\\right)', 'fn', 'Inverse tangent')),
  k('π', 'π', '\\pi', 'fn', 'Pi', k('e', 'e', 'e', 'fn', "Euler's number")),
  k('n!', '!', '!', 'fn', 'Factorial', k('Γ', 'gamma(', '\\operatorname{gamma}\\left(#?\\right)', 'fn', 'Gamma function')),
  k('sinh', 'sinh(', '\\sinh\\left(#?\\right)', 'fn', 'Hyperbolic sine', k(sup('sinh', '−1'), 'asinh(', '\\operatorname{asinh}\\left(#?\\right)', 'fn')),
  k('cosh', 'cosh(', '\\cosh\\left(#?\\right)', 'fn', 'Hyperbolic cosine', k(sup('cosh', '−1'), 'acosh(', '\\operatorname{acosh}\\left(#?\\right)', 'fn')),
  k('tanh', 'tanh(', '\\tanh\\left(#?\\right)', 'fn', 'Hyperbolic tangent', k(sup('tanh', '−1'), 'atanh(', '\\operatorname{atanh}\\left(#?\\right)', 'fn')),
  k('nCr', 'nCr(', '\\binom{#?}{#?}', 'fn', 'Combinations', k('nPr', 'nPr(', '\\operatorname{nPr}\\left(#?,#?\\right)', 'fn', 'Permutations')),
  k("°′″", '°', '^{\\circ}', 'fn', 'Degrees (e.g. sin 30°)', k('DMS', 'dms(', '\\operatorname{dms}\\left(#?,#?,#?\\right)', 'fn', 'Degrees, minutes, seconds → decimal')),
  k('∫', 'integral(', '\\int_{#?}^{#?}#?\\,\\mathrm{d}x', 'fn', 'Definite integral', k('d/dx', 'diff(', '\\frac{\\mathrm{d}}{\\mathrm{d}x}\\left(#?\\right)\\Big|_{x=#?}', 'fn', 'Derivative at a point')),
  k('Σ', 'sigma(', '\\sum_{n=#?}^{#?}\\left(#?\\right)', 'fn', 'Sum', k('Π', 'product(', '\\prod_{n=#?}^{#?}\\left(#?\\right)', 'fn', 'Product')),
  k('lim', 'limit(', '\\lim_{x\\to#?}\\left(#?\\right)', 'fn', 'Limit', k('SOLVE', 'nsolve(', '\\operatorname{nsolve}\\left(#?,x,#?\\right)', 'fn', 'Solve for x near a guess')),
  k('mod', ' mod ', '\\operatorname{mod}', 'fn', 'Remainder', k('gcd', 'gcd(', '\\gcd\\left(#?,#?\\right)', 'fn', 'Greatest common divisor')),
  k('÷R', 'quorem(', '\\operatorname{quorem}\\left(#?,#?\\right)', 'fn', 'Division with remainder', k('lcm', 'lcm(', '\\operatorname{lcm}\\left(#?,#?\\right)', 'fn', 'Least common multiple')),
  k('%', '%', '\\%', 'fn', 'Percent', k('Ran#', 'rand()', '\\operatorname{rand}\\left(\\right)', 'fn', 'Random number')),
  k('i', 'i', 'i', 'fn', 'Imaginary unit', k('arg', 'arg(', '\\operatorname{arg}\\left(#?\\right)', 'fn', 'Argument (angle) of a complex number')),
  k('Pol', 'Pol(', '\\operatorname{Pol}\\left(#?,#?\\right)', 'fn', 'Rectangular → polar: Pol(x, y)', k('Rec', 'Rec(', '\\operatorname{Rec}\\left(#?,#?\\right)', 'fn', 'Polar → rectangular: Rec(r, θ)')),
  k('x', 'x', 'x', 'fn', 'Variable x', k('y', 'y', 'y', 'fn', 'Variable y')),
  k('=', ' = ', '=', 'fn', 'Assign (a = 5), define f(x) = … or verify (2+2 = 4)', k(',', ', ', ',', 'fn', 'Argument separator')),
];

const NUM_KEYS: Key[] = [
  { label: 'MC', action: 'mc', cls: 'mem', title: 'Memory clear' },
  { label: 'MR', action: 'mr', cls: 'mem', title: 'Memory recall' },
  { label: 'M+', action: 'mplus', cls: 'mem', title: 'Add answer to memory' },
  { label: 'M−', action: 'mminus', cls: 'mem', title: 'Subtract answer from memory' },
  k('(', '(', '(', 'act'),
  k(')', ')', ')', 'act'),
  { label: <Delete size={20} />, action: 'back', cls: 'act', title: 'Delete (Backspace)' },
  { label: 'AC', action: 'clear', cls: 'act', title: 'All clear (Esc)' },
  k('7', '7', '7', 'num'), k('8', '8', '8', 'num'), k('9', '9', '9', 'num'), k('÷', '÷', '\\div', 'op', 'Divide'),
  k('4', '4', '4', 'num'), k('5', '5', '5', 'num'), k('6', '6', '6', 'num'), k('×', '×', '\\times', 'op', 'Multiply'),
  k('1', '1', '1', 'num'), k('2', '2', '2', 'num'), k('3', '3', '3', 'num'), k('−', '−', '-', 'op', 'Subtract'),
  k('0', '0', '0', 'num'), k('.', '.', '.', 'num'), k('×10ˣ', '×10^', '\\times10^{#?}', 'num', 'Times ten to the power'), k('+', '+', '+', 'op', 'Add'),
  k('Ans', 'ans', '\\operatorname{ans}', 'act', 'Previous answer'),
  { label: 'S⇔D', action: 'sd', cls: 'act', title: 'Toggle exact / decimal' },
  { label: '=', action: 'eval', cls: 'eq', title: 'Evaluate (Enter)', wide: true },
];

const OPERATOR_START = /^[+×÷*/^!%−]$|^×10\^$|^\^/;

function convertLatex(latex: string): { expr: string; error: string | null } {
  if (!latex.trim()) return { expr: '', error: null };
  try {
    return { expr: latexToExpr(latex), error: null };
  } catch (e) {
    return { expr: '', error: (e as Error).message };
  }
}

export default function Scientific() {
  const calc = getCalculator();
  const prefs = useStore((s) => s.calc);
  const setCalc = useStore((s) => s.setCalc);
  const history = useStore((s) => s.history);
  const addHistory = useStore((s) => s.addHistory);
  const exactDefault = useStore((s) => s.exactDefault);
  const inputStyle = useStore((s) => s.inputStyle);
  const setStore = useStore((s) => s.set);
  const textbook = inputStyle === 'textbook';
  const [input, setInput] = useState('');
  const [latex, setLatex] = useState('');
  const [cursor, setCursor] = useState(0);
  const [last, setLast] = useState<EvalResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shift, setShift] = useState(false);
  const [showExact, setShowExact] = useState(exactDefault);
  const [histIdx, setHistIdx] = useState(-1);
  const [panelOpen, setPanelOpen] = useState(false);
  const [memNonZero, setMemNonZero] = useState(false);
  const [sysKeyboard, setSysKeyboard] = useState(false);
  const [vars, setVars] = useState<Record<string, number>>({});
  const [, force] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const mathRef = useRef<MathInputHandle>(null);
  const wide = useMediaQuery('(min-width: 1100px)');
  const coarse = useMediaQuery('(pointer: coarse)');
  const embedded = typeof location !== 'undefined' && location.pathname.startsWith('/embed');

  useEffect(() => setShowExact(exactDefault), [exactDefault]);

  const conv = useMemo(() => (textbook ? convertLatex(latex) : { expr: input, error: null }), [textbook, latex, input]);
  const source = conv.expr;
  const unknowns = useMemo(() => (source.trim() ? calc.unknownSymbols(source).filter((n) => n.length <= 3) : []), [source, calc, prefs]);
  const extra = useMemo(() => Object.fromEntries(unknowns.filter((n) => Number.isFinite(vars[n])).map((n) => [n, vars[n]])), [unknowns, vars]);

  const preview = useMemo(() => (source.trim() ? calc.preview(source, extra) : null), [source, extra, prefs, calc]);
  const inputTex = useMemo(() => (!textbook && input.trim() ? calc.preview(input, extra)?.inputTex ?? '' : ''), [textbook, input, extra, calc, prefs]);

  const sig = useMemo(() => (textbook ? null : signatureAt(input, cursor)), [textbook, input, cursor]);
  const suggestions = useMemo(() => {
    if (textbook) return [];
    const m = input.slice(0, cursor).match(/([A-Za-z_]\w*)$/);
    if (!m || m[1].length < 2) return [];
    const w = m[1].toLowerCase();
    const lib = calc.libraryFunctionNames.map((n) => ({ name: n, sig: `${n}(…)`, desc: 'From your library' }));
    return [...FN_DOCS, ...lib].filter((d) => d.name.toLowerCase().startsWith(w) && d.name.toLowerCase() !== w).slice(0, 6);
  }, [textbook, input, cursor, calc]);

  const isEmpty = textbook ? !latex.trim() : !input.trim();

  const syncCursor = () => {
    const el = inputRef.current;
    if (el) setCursor(el.selectionStart ?? el.value.length);
  };

  const replaceRange = useCallback(
    (text: string, start: number, end: number) => {
      setInput((prev) => {
        const next = prev.slice(0, start) + text + prev.slice(end);
        const pos = start + text.length;
        requestAnimationFrame(() => {
          const el = inputRef.current;
          if (el) {
            el.setSelectionRange(pos, pos);
            if (!coarse || sysKeyboard) el.focus();
          }
          setCursor(pos);
        });
        return next;
      });
      setError(null);
    },
    [coarse, sysKeyboard],
  );

  const insert = useCallback(
    (key: Key) => {
      if (textbook) {
        const m = mathRef.current;
        if (!m) return;
        if (m.isEmpty() && last?.ok && OPERATOR_START.test(key.insert ?? '')) m.insert('\\operatorname{ans}');
        m.insert(key.latex ?? key.insert ?? '');
        if (!coarse) m.focus();
        setError(null);
        return;
      }
      const text = key.insert ?? '';
      const el = inputRef.current;
      let start = el?.selectionStart ?? cursor;
      let end = el?.selectionEnd ?? cursor;
      if (document.activeElement !== el) {
        start = cursor;
        end = cursor;
      }
      if (!input && last?.ok && OPERATOR_START.test(text)) {
        replaceRange(`ans${text}`, 0, 0);
        return;
      }
      replaceRange(text, start, end);
    },
    [textbook, cursor, input, last, replaceRange, coarse],
  );

  const clearInput = () => {
    setInput('');
    setLatex('');
    mathRef.current?.setValue('');
    setCursor(0);
    setError(null);
  };

  const evaluate = useCallback(() => {
    // read the editor directly so a very fast "=" never sees stale state
    const live = textbook ? convertLatex(mathRef.current?.getValue() ?? latex) : conv;
    if (live.error) {
      setError(live.error);
      haptic(20);
      return;
    }
    const src = live.expr.trim();
    if (!src) return;
    const missing = unknowns.filter((n) => !Number.isFinite(vars[n]));
    const r = calc.evaluate(src, extra);
    if (!r.ok) {
      setError(missing.length && /Unknown variable/.test(r.error ?? '') ? `Enter a value for ${missing.join(', ')} below` : r.error ?? 'Error');
      haptic(20);
      return;
    }
    setError(null);
    setLast(r);
    const savedLatex = textbook ? mathRef.current?.getValue() ?? latex : undefined;
    clearInput();
    setHistIdx(-1);
    setShowExact(exactDefault);
    setMemNonZero(Number(calc.memoryRecall()) !== 0);
    addHistory({ input: src, result: r.text, tex: r.tex, inputTex: r.inputTex, latex: savedLatex });
    emitEmbed('result', { input: src, result: r.text, tex: r.tex });
    force((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv, source, unknowns, vars, extra, calc, textbook, latex, addHistory, exactDefault]);

  const press = (key: Key) => {
    haptic();
    const kk = shift && key.shift ? key.shift : key;
    if (shift && key.action !== 'shift') setShift(false);
    if (kk.insert !== undefined) {
      insert(kk);
      return;
    }
    switch (kk.action) {
      case 'eval':
        evaluate();
        break;
      case 'clear':
        if (isEmpty) setLast(null);
        clearInput();
        break;
      case 'back': {
        if (textbook) {
          mathRef.current?.command('deleteBackward');
          break;
        }
        const el = inputRef.current;
        const s = el?.selectionStart ?? cursor;
        const e = el?.selectionEnd ?? cursor;
        if (s !== e) replaceRange('', s, e);
        else if (s > 0) {
          const before = input.slice(0, s);
          const m = before.match(/([A-Za-z_]\w*\(|\s(?:mod)\s|ans)$/);
          const n = m ? m[1].length : 1;
          replaceRange('', s - n, s);
        }
        break;
      }
      case 'shift':
        setShift((v) => !v);
        break;
      case 'angle':
        setCalc({ angle: prefs.angle === 'deg' ? 'rad' : prefs.angle === 'rad' ? 'grad' : 'deg' });
        break;
      case 'left':
      case 'right': {
        if (textbook) {
          mathRef.current?.command(kk.action === 'left' ? 'moveToPreviousChar' : 'moveToNextChar');
          break;
        }
        const p = Math.max(0, Math.min(input.length, cursor + (kk.action === 'left' ? -1 : 1)));
        setCursor(p);
        inputRef.current?.setSelectionRange(p, p);
        break;
      }
      case 'mplus':
      case 'mminus':
        calc.memoryAdd(kk.action === 'mplus' ? 1 : -1);
        setMemNonZero(Number(calc.memoryRecall()) !== 0);
        toast(`Memory: ${calc.format(calc.memoryRecall()).text}`);
        break;
      case 'mr':
        insert({ label: 'M', insert: 'M', latex: 'M' });
        break;
      case 'mc':
        calc.memoryClear();
        setMemNonZero(false);
        break;
      case 'sd':
        setShowExact((v) => !v);
        break;
    }
  };

  const recall = (dir: 1 | -1) => {
    if (!history.length) return;
    const i = Math.max(-1, Math.min(histIdx + dir, history.length - 1));
    setHistIdx(i);
    const h = i >= 0 ? history[i] : null;
    if (textbook) {
      const l = h ? h.latex ?? h.input : '';
      setLatex(l);
      mathRef.current?.setValue(l);
    } else setInput(h ? h.input : '');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      evaluate();
    } else if (e.key === 'Escape') clearInput();
    else if (e.key === 'Tab' && suggestions.length) {
      e.preventDefault();
      acceptSuggestion(suggestions[0].name);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      recall(1);
      requestAnimationFrame(() => syncCursor());
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      recall(-1);
    } else if (!input && last?.ok && e.key.length === 1 && /[+*/^!%]/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      insert({ label: e.key, insert: e.key });
    }
  };

  const acceptSuggestion = (name: string) => {
    const m = input.slice(0, cursor).match(/([A-Za-z_]\w*)$/);
    if (!m) return;
    const start = cursor - m[1].length;
    replaceRange(name !== 'to' ? `${name}(` : `${name} `, start, cursor);
  };

  const loadEntry = (h: HistoryEntry) => {
    if (textbook) {
      const l = h.latex ?? h.input;
      setLatex(l);
      mathRef.current?.setValue(l);
      requestAnimationFrame(() => mathRef.current?.focus());
    } else {
      setInput(h.input);
      setCursor(h.input.length);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    setPanelOpen(false);
  };

  const exact = last?.exact;
  const resultTex = last ? (showExact && exact ? exact.tex : last.tex) : '';
  const resultText = last ? (showExact && exact ? exact.text : last.text) : '';
  const angleLabel = prefs.angle.toUpperCase();
  const alts = useMemo(() => (last?.ok ? alternativeForms(last.value, prefs.angle, { dms: /a(sin|cos|tan|rg)|deg|dms|°|Pol/.test(last.input) }).filter((a) => a.text !== resultText && a.text !== last.text) : []), [last, prefs.angle, resultText]);

  const renderKey = (key: Key, i: number) => {
    const kk = shift && key.shift ? key.shift : key;
    const label = key.action === 'angle' ? angleLabel : kk.label;
    const active = (key.action === 'shift' && shift) || (key.action === 'sd' && showExact && !!exact);
    return (
      <button
        key={i}
        className={`key key-${kk.cls ?? 'fn'}${key.wide ? ' key-wide' : ''}${active ? ' key-active' : ''}${shift && key.shift ? ' key-shifted' : ''}`}
        onClick={() => press(key)}
        onMouseDown={(e) => e.preventDefault()}
        title={kk.title}
        aria-label={kk.title ?? (typeof label === 'string' ? label : undefined)}
      >
        {label}
        {!shift && key.shift && <span className="key-alt" aria-hidden />}
      </button>
    );
  };

  const panel = (
    <SidePanel
      onInsert={(t) => {
        insert({ label: t, insert: t, latex: t });
        setPanelOpen(false);
      }}
      onLoad={loadEntry}
    />
  );

  return (
    <div className="sci">
      <div className="sci-main">
        <section className="display card" aria-label="Display">
          <div className="display-bar">
            <button className="badge accent" onClick={() => press({ label: '', action: 'angle' })} title="Angle unit (click to change)">
              {angleLabel}
            </button>
            <span className="badge">
              {prefs.notation === 'auto' ? 'NORM' : prefs.notation.toUpperCase()}
              {prefs.notation !== 'auto' ? ` ${prefs.digits}` : ''}
            </span>
            {prefs.bignumber && <span className="badge">HP</span>}
            {memNonZero && (
              <span className="badge" title={`Memory: ${calc.format(calc.memoryRecall()).text}`}>
                M
              </span>
            )}
            {shift && <span className="badge accent">2nd</span>}
            <div className="spacer" />
            <button
              className="badge input-style"
              onClick={() => {
                setStore({ inputStyle: textbook ? 'linear' : 'textbook' });
                clearInput();
              }}
              title={textbook ? 'Textbook input: fractions stack, roots have a radical. Click for one-line input.' : 'One-line input. Click for textbook input.'}
            >
              {textbook ? 'Textbook' : 'Linear'}
            </button>
            {coarse && (
              <button
                className={`icon-btn sm${sysKeyboard ? ' active' : ''}`}
                onClick={() => {
                  setSysKeyboard((v) => !v);
                  if (textbook) (sysKeyboard ? mathRef.current?.hideKeyboard() : mathRef.current?.showKeyboard());
                }}
                aria-label="Keyboard"
                title="Keyboard"
              >
                <Keyboard size={16} />
              </button>
            )}
            {!wide && (
              <button className="icon-btn sm" onClick={() => setPanelOpen(true)} aria-label="History and variables" title="History & variables">
                <History size={16} />
              </button>
            )}
          </div>

          <div className="display-echo" aria-live="polite">
            {!isEmpty && !textbook ? (
              inputTex ? <Tex tex={inputTex} /> : <span className="muted">{input}</span>
            ) : last ? (
              <>
                {last.inputTex ? <Tex tex={last.inputTex} /> : <span>{last.input}</span>}
                <span className="muted"> =</span>
              </>
            ) : (
              <span className="muted small">
                {textbook ? 'Type naturally — / makes a fraction, ^ a power. Or use the keypad.' : 'Type an expression or use the keypad. Try: 2^10, sin(30), integral(x^2, x, 0, 3), 5 km to mi'}
              </span>
            )}
          </div>

          {textbook ? (
            <MathInput
              ref={mathRef}
              className="display-math"
              onChange={(l) => {
                setLatex(l);
                setError(null);
                setHistIdx(-1);
              }}
              onEnter={evaluate}
              onKey={(e) => {
                if (e.key === 'Escape') {
                  clearInput();
                  return true;
                }
                if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (e.ctrlKey || e.altKey)) {
                  recall(e.key === 'ArrowUp' ? 1 : -1);
                  return true;
                }
                if (mathRef.current?.isEmpty() && last?.ok && e.key.length === 1 && /[+*/^!%]/.test(e.key) && !e.ctrlKey && !e.metaKey) {
                  mathRef.current.insert('\\operatorname{ans}');
                }
                return false;
              }}
              autoFocus={!coarse && !embedded}
              placeholder={last ? '\\operatorname{ans}\\ldots' : '0'}
              ariaLabel="Expression"
            />
          ) : (
            <input
              ref={inputRef}
              className="display-input"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setCursor(e.target.selectionStart ?? e.target.value.length);
                setError(null);
                setHistIdx(-1);
              }}
              onKeyDown={onKeyDown}
              onSelect={syncCursor}
              onClick={syncCursor}
              inputMode={coarse && !sysKeyboard ? 'none' : 'text'}
              autoFocus={!coarse && !embedded}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              aria-label="Expression"
              placeholder={last ? 'ans …' : '0'}
            />
          )}

          {sig && (
            <div className="sig-help">
              <SigHelp sig={sig.doc.sig} arg={sig.arg} />
              <span className="muted"> — {sig.doc.desc}</span>
            </div>
          )}
          {suggestions.length > 0 && (
            <div className="suggest" role="listbox" aria-label="Suggestions">
              {suggestions.map((s) => (
                <button key={s.name} onMouseDown={(e) => e.preventDefault()} onClick={() => acceptSuggestion(s.name)} title={s.desc}>
                  <code>{s.sig}</code>
                </button>
              ))}
              <span className="muted small">Tab</span>
            </div>
          )}
          {unknowns.length > 0 && (
            <div className="calc-vars" aria-label="Variable values">
              <span className="small muted">Values:</span>
              {unknowns.map((n) => (
                <label key={n} className="calc-var">
                  <span>{n} =</span>
                  <NumberInput value={vars[n] ?? NaN} allowEmpty onChange={(v) => setVars((s) => ({ ...s, [n]: v }))} ariaLabel={`Value of ${n}`} placeholder="?" />
                </label>
              ))}
            </div>
          )}

          <div className="display-result">
            {error ? (
              <span className="error-text" role="alert">
                {error}
              </span>
            ) : !isEmpty ? (
              preview && preview.kind !== 'empty' ? (
                <span className="result-preview">
                  <Tex tex={preview.exact && showExact ? preview.exact.tex : preview.tex} />
                </span>
              ) : null
            ) : last ? (
              <div className="result-main">
                <span className="result-value num">
                  <Tex tex={resultTex} />
                </span>
                {exact && <span className="muted small">{showExact ? `≈ ${last.text}` : `= ${exact.text}`}</span>}
                <button className="icon-btn sm" onClick={() => copyText(resultText)} aria-label="Copy result" title="Copy">
                  <Copy size={15} />
                </button>
              </div>
            ) : (
              <span className="result-value muted">0</span>
            )}
          </div>
          {isEmpty && alts.length > 0 && (
            <div className="alt-forms" aria-label="Other forms of the answer">
              {alts.map((a) => (
                <button key={a.label} className="alt-form" onClick={() => copyText(a.text, `Copied ${a.text}`)} title={`${a.label} — click to copy`}>
                  <span className="alt-label">{a.label}</span>
                  <Tex tex={a.tex} />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="keypad" aria-label="Keypad">
          <div className="keys-fn">{FN_KEYS.map(renderKey)}</div>
          <div className="keys-num">{NUM_KEYS.map(renderKey)}</div>
          <div className="keys-nav">
            <button className="key key-act" onMouseDown={(e) => e.preventDefault()} onClick={() => press({ label: '', action: 'left' })} aria-label="Cursor left">
              <ChevronLeft size={18} />
            </button>
            <button className="key key-act" onMouseDown={(e) => e.preventDefault()} onClick={() => press({ label: '', action: 'right' })} aria-label="Cursor right">
              <ChevronRight size={18} />
            </button>
          </div>
        </section>
      </div>

      {wide ? (
        <aside className="sci-panel card">{panel}</aside>
      ) : (
        panelOpen && (
          <>
            <div className="overlay" style={{ padding: 0 }} onClick={() => setPanelOpen(false)} />
            <aside className="drawer" role="dialog" aria-label="History and variables">
              <div className="drawer-header">
                <h2>History & variables</h2>
                <div className="spacer" />
                <button className="icon-btn" onClick={() => setPanelOpen(false)} aria-label="Close">
                  <X size={18} />
                </button>
              </div>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{panel}</div>
            </aside>
          </>
        )
      )}
    </div>
  );
}
