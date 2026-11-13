import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Copy, History, Trash2, X, Delete, ChevronLeft, ChevronRight, Search, Keyboard } from 'lucide-react';
import { getCalculator } from '../engine';
import { useStore } from '../store';
import { Tex, copyText, haptic, useMediaQuery, Segmented } from '../ui';
import { FN_DOCS, CONSTANTS, signatureAt, sigParts } from '../fnDocs';
import { emitEmbed } from '../../embed/bridge';
import type { EvalResult } from '../../core/index';
import '../../styles/modes/scientific.css';

type Action = 'eval' | 'clear' | 'back' | 'shift' | 'left' | 'right' | 'mplus' | 'mminus' | 'mr' | 'mc' | 'angle' | 'sd';
interface Key {
  label: ReactNode;
  insert?: string;
  action?: Action;
  cls?: 'num' | 'fn' | 'op' | 'eq' | 'act' | 'mem';
  title?: string;
  shift?: Key;
  wide?: boolean;
}

const k = (label: ReactNode, insert: string, cls: Key['cls'] = 'fn', title?: string, shift?: Key): Key => ({ label, insert, cls, title, shift });
const sup = (base: string, s: string) => (
  <span>
    {base}
    <sup>{s}</sup>
  </span>
);

const FN_KEYS: Key[] = [
  { label: '2nd', action: 'shift', cls: 'act', title: 'Second function' },
  { label: 'DEG', action: 'angle', cls: 'act', title: 'Cycle angle unit' },
  k('sin', 'sin(', 'fn', 'Sine', k(sup('sin', '−1'), 'asin(', 'fn', 'Inverse sine')),
  k('cos', 'cos(', 'fn', 'Cosine', k(sup('cos', '−1'), 'acos(', 'fn', 'Inverse cosine')),
  k('tan', 'tan(', 'fn', 'Tangent', k(sup('tan', '−1'), 'atan(', 'fn', 'Inverse tangent')),
  k(sup('x', '2'), '^2', 'fn', 'Square', k(sup('x', '3'), '^3', 'fn', 'Cube')),
  k(sup('x', 'y'), '^', 'fn', 'Power', k(<span>ʸ√x</span>, 'root(', 'fn', 'n-th root: root(x, n)')),
  k('√', '√(', 'fn', 'Square root', k('∛', 'cbrt(', 'fn', 'Cube root')),
  k(sup('x', '−1'), '^(-1)', 'fn', 'Reciprocal', k('|x|', 'abs(', 'fn', 'Absolute value')),
  k('ln', 'ln(', 'fn', 'Natural log', k(sup('e', 'x'), 'e^(', 'fn', 'Exponential')),
  k('log', 'log(', 'fn', 'Log base 10 — log(x, b) for base b', k(sup('10', 'x'), '10^(', 'fn', 'Power of ten')),
  k('π', 'π', 'fn', 'Pi', k('e', 'e', 'fn', "Euler's number")),
  k('n!', '!', 'fn', 'Factorial', k('Γ', 'gamma(', 'fn', 'Gamma function')),
  k('nCr', 'nCr(', 'fn', 'Combinations nCr(n, r)', k('nPr', 'nPr(', 'fn', 'Permutations nPr(n, r)')),
  k('sinh', 'sinh(', 'fn', 'Hyperbolic sine', k(sup('sinh', '−1'), 'asinh(', 'fn')),
  k('cosh', 'cosh(', 'fn', 'Hyperbolic cosine', k(sup('cosh', '−1'), 'acosh(', 'fn')),
  k('tanh', 'tanh(', 'fn', 'Hyperbolic tangent', k(sup('tanh', '−1'), 'atanh(', 'fn')),
  k('∫', 'integral(', 'fn', 'Integral: integral(f, x, a, b)', k('d/dx', 'diff(', 'fn', 'Derivative: diff(f, x, a)')),
  k('Σ', 'sigma(', 'fn', 'Sum: sigma(f, n, a, b)', k('Π', 'product(', 'fn', 'Product: product(f, n, a, b)')),
  k('mod', ' mod ', 'fn', 'Remainder', k('gcd', 'gcd(', 'fn', 'Greatest common divisor')),
  k('%', '%', 'fn', 'Percent', k('lcm', 'lcm(', 'fn', 'Least common multiple')),
  k('i', 'i', 'fn', 'Imaginary unit', k('∠', 'arg(', 'fn', 'Argument of complex number')),
  k('Ran#', 'rand()', 'fn', 'Random number', k('RanInt', 'randInt(', 'fn', 'Random integer randInt(a, b)')),
  k('x', 'x', 'fn', 'Variable x', k('y', 'y', 'fn', 'Variable y')),
  k('=', ' = ', 'fn', 'Assign: a = 5 or f(x) = x^2', k(',', ', ', 'fn', 'Argument separator')),
];

const NUM_KEYS: Key[] = [
  { label: 'MC', action: 'mc', cls: 'mem', title: 'Memory clear' },
  { label: 'MR', action: 'mr', cls: 'mem', title: 'Memory recall' },
  { label: 'M+', action: 'mplus', cls: 'mem', title: 'Add answer to memory' },
  { label: 'M−', action: 'mminus', cls: 'mem', title: 'Subtract answer from memory' },
  k('(', '(', 'act'),
  k(')', ')', 'act'),
  { label: <Delete size={20} />, action: 'back', cls: 'act', title: 'Delete (Backspace)' },
  { label: 'AC', action: 'clear', cls: 'act', title: 'All clear (Esc)' },
  k('7', '7', 'num'), k('8', '8', 'num'), k('9', '9', 'num'), k('÷', '÷', 'op', 'Divide'),
  k('4', '4', 'num'), k('5', '5', 'num'), k('6', '6', 'num'), k('×', '×', 'op', 'Multiply'),
  k('1', '1', 'num'), k('2', '2', 'num'), k('3', '3', 'num'), k('−', '−', 'op', 'Subtract'),
  k('0', '0', 'num'), k('.', '.', 'num'), k('×10ˣ', '×10^', 'num', 'Times ten to the power'), k('+', '+', 'op', 'Add'),
  k('Ans', 'ans', 'act', 'Previous answer'),
  { label: 'S⇔D', action: 'sd', cls: 'act', title: 'Toggle exact / decimal' },
  { label: '=', action: 'eval', cls: 'eq', title: 'Evaluate (Enter)', wide: true },
];

const OPERATOR_START = /^[+×÷*/^!%−]$|^×10\^$|^\^/;

export default function Scientific() {
  const calc = getCalculator();
  const prefs = useStore((s) => s.calc);
  const setCalc = useStore((s) => s.setCalc);
  const history = useStore((s) => s.history);
  const addHistory = useStore((s) => s.addHistory);
  const exactDefault = useStore((s) => s.exactDefault);
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState(0);
  const [last, setLast] = useState<EvalResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shift, setShift] = useState(false);
  const [showExact, setShowExact] = useState(exactDefault);
  const [histIdx, setHistIdx] = useState(-1);
  const [panelOpen, setPanelOpen] = useState(false);
  const [memNonZero, setMemNonZero] = useState(false);
  const [sysKeyboard, setSysKeyboard] = useState(false);
  const [, force] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wide = useMediaQuery('(min-width: 1100px)');
  const coarse = useMediaQuery('(pointer: coarse)');

  useEffect(() => setShowExact(exactDefault), [exactDefault]);

  const preview = useMemo(() => {
    if (!input.trim()) return null;
    return calc.preview(input);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, prefs, calc]);

  const inputTex = useMemo(() => {
    if (!input.trim()) return '';
    try {
      const r = calc.preview(input);
      if (r?.inputTex) return r.inputTex;
      return '';
    } catch {
      return '';
    }
  }, [input, calc, prefs]);

  const sig = useMemo(() => signatureAt(input, cursor), [input, cursor]);
  const suggestions = useMemo(() => {
    const m = input.slice(0, cursor).match(/([A-Za-z_]\w*)$/);
    if (!m || m[1].length < 2) return [];
    const w = m[1].toLowerCase();
    const lib = calc.libraryFunctionNames.map((n) => ({ name: n, sig: `${n}(…)`, desc: 'From your library' }));
    return [...FN_DOCS, ...lib].filter((d) => d.name.toLowerCase().startsWith(w) && d.name.toLowerCase() !== w).slice(0, 6);
  }, [input, cursor, calc]);

  const syncCursor = () => {
    const el = inputRef.current;
    if (el) setCursor(el.selectionStart ?? el.value.length);
  };

  const replaceRange = useCallback((text: string, start: number, end: number, caretOffset?: number) => {
    setInput((prev) => {
      const next = prev.slice(0, start) + text + prev.slice(end);
      const pos = start + (caretOffset ?? text.length);
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
  }, [coarse, sysKeyboard]);

  const insert = useCallback((text: string) => {
    const el = inputRef.current;
    let start = el?.selectionStart ?? cursor;
    let end = el?.selectionEnd ?? cursor;
    if (document.activeElement !== el) {
      start = cursor;
      end = cursor;
    }
    // continue from the previous answer when starting with an operator
    if (!input && last?.ok && OPERATOR_START.test(text)) {
      replaceRange(`ans${text}`, 0, 0);
      return;
    }
    replaceRange(text, start, end);
  }, [cursor, input, last, replaceRange]);

  const evaluate = useCallback(() => {
    const src = input.trim();
    if (!src) return;
    const r = calc.evaluate(src);
    if (!r.ok) {
      setError(r.error ?? 'Error');
      haptic(20);
      return;
    }
    setError(null);
    setLast(r);
    setInput('');
    setCursor(0);
    setHistIdx(-1);
    setShowExact(exactDefault);
    setMemNonZero(Number(calc.memoryRecall()) !== 0);
    addHistory({ input: src, result: r.text, tex: r.tex, inputTex: r.inputTex });
    emitEmbed('result', { input: src, result: r.text, tex: r.tex });
    force((n) => n + 1);
  }, [input, calc, addHistory, exactDefault]);

  const press = (key: Key) => {
    haptic();
    const kk = shift && key.shift ? key.shift : key;
    if (shift && key.action !== 'shift') setShift(false);
    if (kk.insert !== undefined) {
      insert(kk.insert);
      return;
    }
    switch (kk.action) {
      case 'eval':
        evaluate();
        break;
      case 'clear':
        setInput('');
        setCursor(0);
        setError(null);
        if (!input) setLast(null);
        break;
      case 'back': {
        const el = inputRef.current;
        const s = el?.selectionStart ?? cursor;
        const e = el?.selectionEnd ?? cursor;
        if (s !== e) replaceRange('', s, e);
        else if (s > 0) {
          // delete whole function names like "sin(" in one step
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
        const p = Math.max(0, Math.min(input.length, cursor + (kk.action === 'left' ? -1 : 1)));
        setCursor(p);
        inputRef.current?.setSelectionRange(p, p);
        break;
      }
      case 'mplus':
      case 'mminus':
        calc.memoryAdd(kk.action === 'mplus' ? 1 : -1);
        setMemNonZero(Number(calc.memoryRecall()) !== 0);
        break;
      case 'mr':
        insert('M');
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestions.length && e.ctrlKey) acceptSuggestion(suggestions[0].name);
      else evaluate();
    } else if (e.key === 'Escape') {
      setInput('');
      setError(null);
    } else if (e.key === 'Tab' && suggestions.length) {
      e.preventDefault();
      acceptSuggestion(suggestions[0].name);
    } else if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault();
      const i = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(i);
      setInput(history[i].input);
      requestAnimationFrame(() => syncCursor());
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const i = histIdx - 1;
      setHistIdx(Math.max(-1, i));
      setInput(i >= 0 ? history[i].input : '');
    } else if (!input && last?.ok && e.key.length === 1 && /[+*/^!%]/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      insert(e.key);
    }
  };

  const acceptSuggestion = (name: string) => {
    const m = input.slice(0, cursor).match(/([A-Za-z_]\w*)$/);
    if (!m) return;
    const start = cursor - m[1].length;
    const isFn = name !== 'to';
    replaceRange(isFn ? `${name}(` : `${name} `, start, cursor);
  };

  const exact = last?.exact;
  const resultTex = last ? (showExact && exact ? exact.tex : last.tex) : '';
  const resultText = last ? (showExact && exact ? exact.text : last.text) : '';
  const angleLabel = prefs.angle.toUpperCase();

  const renderKey = (key: Key, i: number) => {
    const kk = shift && key.shift ? key.shift : key;
    const label = key.action === 'angle' ? angleLabel : kk.label;
    const active = (key.action === 'shift' && shift) || (key.action === 'sd' && showExact && !!exact);
    return (
      <button
        key={i}
        className={`key key-${kk.cls ?? 'fn'}${key.wide ? ' key-wide' : ''}${active ? ' key-active' : ''}${shift && key.shift ? ' key-shifted' : ''}`}
        onClick={() => press(key)}
        title={kk.title}
        aria-label={kk.title ?? (typeof label === 'string' ? label : undefined)}
      >
        {label}
      </button>
    );
  };

  const panel = (
    <SidePanel
      onInsert={(t) => {
        insert(t);
        setPanelOpen(false);
      }}
      onLoad={(t) => {
        setInput(t);
        setCursor(t.length);
        setPanelOpen(false);
        requestAnimationFrame(() => inputRef.current?.focus());
      }}
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
            <span className="badge">{prefs.notation === 'auto' ? 'NORM' : prefs.notation.toUpperCase()}{prefs.notation !== 'auto' ? ` ${prefs.digits}` : ''}</span>
            {prefs.bignumber && <span className="badge">HP</span>}
            {memNonZero && <span className="badge" title={`Memory: ${calc.format(calc.memoryRecall()).text}`}>M</span>}
            {shift && <span className="badge accent">2nd</span>}
            <div className="spacer" />
            {coarse && (
              <button className={`icon-btn sm${sysKeyboard ? ' active' : ''}`} onClick={() => setSysKeyboard((v) => !v)} aria-label="Use system keyboard" title="System keyboard">
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
            {input ? (
              inputTex ? <Tex tex={inputTex} /> : <span className="muted">{input}</span>
            ) : last ? (
              <>
                {last.inputTex ? <Tex tex={last.inputTex} /> : <span>{last.input}</span>}
                <span className="muted"> =</span>
              </>
            ) : (
              <span className="muted small">Type an expression or use the keypad. Try: 2^10, sin(30), integral(x^2, x, 0, 3), 5 km to mi</span>
            )}
          </div>

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
            autoFocus={!coarse && !location.pathname.startsWith('/embed')}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-label="Expression"
            placeholder={last ? 'ans …' : '0'}
          />

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

          <div className="display-result">
            {error ? (
              <span className="error-text" role="alert">
                {error}
              </span>
            ) : input ? (
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
                {exact && showExact && exact.mixed && <span className="muted small">= {exact.mixed.text}</span>}
                {exact && <span className="muted small">{showExact ? `≈ ${last.text}` : `= ${exact.text}`}</span>}
                <button className="icon-btn sm" onClick={() => copyText(resultText)} aria-label="Copy result" title="Copy">
                  <Copy size={15} />
                </button>
              </div>
            ) : (
              <span className="result-value muted">0</span>
            )}
          </div>
        </section>

        <section className="keypad" aria-label="Keypad">
          <div className="keys-fn">{FN_KEYS.map(renderKey)}</div>
          <div className="keys-num">
            {NUM_KEYS.map(renderKey)}
          </div>
          <div className="keys-nav">
            <button className="key key-act" onClick={() => press({ label: '', action: 'left' })} aria-label="Cursor left">
              <ChevronLeft size={18} />
            </button>
            <button className="key key-act" onClick={() => press({ label: '', action: 'right' })} aria-label="Cursor right">
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

function SigHelp({ sig, arg }: { sig: string; arg: number }) {
  const { name, args } = sigParts(sig);
  return (
    <code>
      {name}(
      {args.map((a, i) => (
        <span key={i}>
          {i > 0 && ', '}
          <span className={i === arg ? 'sig-active' : ''}>{a}</span>
        </span>
      ))}
      )
    </code>
  );
}

function SidePanel({ onInsert, onLoad }: { onInsert: (t: string) => void; onLoad: (t: string) => void }) {
  const [tab, setTab] = useState<'history' | 'vars' | 'consts' | 'fns'>('history');
  const history = useStore((s) => s.history);
  const removeHistory = useStore((s) => s.removeHistory);
  const clearHistory = useStore((s) => s.clearHistory);
  const [q, setQ] = useState('');
  const calc = getCalculator();
  const [, force] = useState(0);
  const vars = calc.variables().filter((v) => !(v.name === 'M' && v.text === '0'));
  const fns = FN_DOCS.filter((d) => !q || `${d.name} ${d.desc} ${d.cat}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="side-panel">
      <div style={{ padding: '10px 10px 0' }}>
        <Segmented
          value={tab}
          onChange={setTab}
          size="sm"
          options={[
            { value: 'history', label: 'History' },
            { value: 'vars', label: 'Variables' },
            { value: 'consts', label: 'Constants' },
            { value: 'fns', label: 'Functions' },
          ]}
        />
      </div>
      <div className="side-list">
        {tab === 'history' &&
          (history.length === 0 ? (
            <div className="empty">
              <History size={22} />
              Your calculations will appear here.
            </div>
          ) : (
            <>
              {history.slice(0, 200).map((h) => (
                <div key={h.id} className="hist-item">
                  <button className="hist-input" onClick={() => onLoad(h.input)} title="Edit this expression">
                    {h.inputTex ? <Tex tex={h.inputTex} /> : h.input}
                  </button>
                  <div className="row nowrap">
                    <button className="hist-result num" onClick={() => onInsert(h.result.replace(/,/g, '').replace(/E/, 'e'))} title="Insert result">
                      = {h.tex ? <Tex tex={h.tex} /> : h.result}
                    </button>
                    <div className="spacer" />
                    <button className="icon-btn sm hist-act" onClick={() => copyText(h.result)} aria-label="Copy">
                      <Copy size={14} />
                    </button>
                    <button className="icon-btn sm hist-act" onClick={() => removeHistory(h.id)} aria-label="Delete">
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
              <button className="btn btn-ghost btn-sm" style={{ margin: 8 }} onClick={clearHistory}>
                <Trash2 size={14} /> Clear history
              </button>
            </>
          ))}
        {tab === 'vars' && (
          <>
            {vars.length === 0 ? (
              <div className="empty">
                No variables yet. Assign with <code>a = 5</code> or define <code>f(x) = x^2</code>.
              </div>
            ) : (
              vars.map((v) => (
                <div key={v.name} className="var-item">
                  <button className="var-name" onClick={() => onInsert(v.name)}>
                    <code>{v.isFunction ? v.text : v.name}</code>
                  </button>
                  {!v.isFunction && <span className="num var-val">{v.tex ? <Tex tex={v.tex} /> : v.text}</span>}
                  <div className="spacer" />
                  <button
                    className="icon-btn sm"
                    onClick={() => {
                      calc.deleteVariable(v.name);
                      force((n) => n + 1);
                    }}
                    aria-label={`Delete ${v.name}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))
            )}
            {calc.libraryFunctionNames.length > 0 && (
              <div className="small muted" style={{ padding: '8px 12px' }}>
                Library: {calc.libraryFunctionNames.join(', ')} — edit in Code & Library.
              </div>
            )}
          </>
        )}
        {tab === 'consts' &&
          CONSTANTS.map((c) => (
            <button key={c.insert} className="const-item" onClick={() => onInsert(c.insert)} title={`Insert ${c.insert}`}>
              <span className="const-sym">{c.sym}</span>
              <span className="stack-sm" style={{ gap: 0, minWidth: 0 }}>
                <span>{c.name}</span>
                <span className="small muted num">{c.value}</span>
              </span>
            </button>
          ))}
        {tab === 'fns' && (
          <>
            <div className="row nowrap" style={{ padding: '4px 10px 8px' }}>
              <Search size={15} className="muted" />
              <input className="input" style={{ height: 30 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search functions" aria-label="Search functions" />
            </div>
            {fns.map((d) => (
              <button key={d.name} className="const-item" onClick={() => onInsert(d.name === 'to' ? ' to ' : `${d.name}(`)}>
                <span className="stack-sm" style={{ gap: 0, minWidth: 0 }}>
                  <code>{d.sig}</code>
                  <span className="small muted">{d.desc}</span>
                </span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
