/**
 * Function palette for the graph editor — a Desmos-style keypad that inserts
 * into the expression you were last editing.
 */
import { useState } from 'react';

let lastInput: HTMLInputElement | null = null;
let lastSel: [number, number] = [0, 0];

/** Remember the focused expression input and its caret (call from onFocus / onSelect). */
export function trackExprInput(el: HTMLInputElement) {
  lastInput = el;
  lastSel = [el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length];
}

function insertIntoLast(text: string, caretBack = 0) {
  const el = lastInput && document.contains(lastInput) ? lastInput : document.querySelector<HTMLInputElement>('input[data-expr]');
  if (!el) return;
  const [s, e] = lastInput === el ? lastSel : [el.value.length, el.value.length];
  const next = el.value.slice(0, s) + text + el.value.slice(e);
  // use the native setter so React sees the change
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, next);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  const pos = s + text.length - caretBack;
  el.focus();
  el.setSelectionRange(pos, pos);
  trackExprInput(el);
}

interface PItem {
  label: string;
  insert: string;
  back?: number;
  title?: string;
}

const P = (label: string, insert: string, back = 0, title?: string): PItem => ({ label, insert, back, title });

const GROUPS: { id: string; label: string; items: PItem[] }[] = [
  {
    id: 'basic',
    label: 'Basic',
    items: [
      P('y =', 'y = '), P('x', 'x'), P('x²', '^2'), P('xⁿ', '^'), P('√', 'sqrt()', 1), P('ⁿ√', 'nthRoot(, n)', 4), P('|x|', 'abs()', 1), P('π', 'π'), P('e', 'e'),
      P('(', '('), P(')', ')'), P('<', ' < '), P('≤', ' <= '), P('>', ' > '), P('≥', ' >= '), P('{…}', ' {}', 1, 'Restriction, e.g. {0 < x < 2}'), P('θ', 'θ'), P('t', 't'),
    ],
  },
  {
    id: 'trig',
    label: 'Trig',
    items: ['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh'].map((f) => P(f, `${f}()`, 1)),
  },
  {
    id: 'func',
    label: 'Functions',
    items: [
      P('ln', 'ln()', 1), P('log', 'log()', 1), P('logₐ', 'log(, a)', 4), P('exp', 'exp()', 1), P('floor', 'floor()', 1), P('ceil', 'ceil()', 1), P('round', 'round()', 1),
      P('mod', 'mod(, )', 3), P('min', 'min(, )', 3), P('max', 'max(, )', 3), P('sign', 'sign()', 1), P('n!', '!'), P('nCr', 'nCr(, )', 3), P('gcd', 'gcd(, )', 3),
    ],
  },
  {
    id: 'calc',
    label: 'Calculus',
    items: [
      P("f(x) =", 'f(x) = ', 0, 'Define a function'), P("f′(x)", "f'(x)", 0, 'Derivative of a defined function'), P("f″(x)", "f''(x)"),
      P('∫', 'integral(, t, 0, x)', 13, 'Area function: integral(f(t), t, a, x)'), P('Σ', 'sigma(, n, 1, 10)', 13, 'Sum'), P('d/dx', 'diff(, t, x)', 7, 'Derivative at x'),
    ],
  },
  {
    id: 'stats',
    label: 'Stats',
    items: [P('normalpdf', 'normalpdf(x, 0, 1)'), P('normalcdf', 'normalcdf(-Infinity, x, 0, 1)'), P('tpdf', 'tpdf(x, 5)'), P('chi2pdf', 'chi2pdf(x, 3)'), P('binompdf', 'binompdf(10, 0.5, floor(x))')],
  },
];

export function Palette() {
  const [group, setGroup] = useState(GROUPS[0].id);
  const g = GROUPS.find((x) => x.id === group)!;
  return (
    <div className="graph-palette" role="toolbar" aria-label="Insert function">
      <div className="segmented sm">
        {GROUPS.map((x) => (
          <button key={x.id} className={x.id === group ? 'active' : ''} onClick={() => setGroup(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="graph-palette-keys">
        {g.items.map((it) => (
          <button key={it.label} className="pal-key" title={it.title ?? it.insert} onMouseDown={(e) => e.preventDefault()} onClick={() => insertIntoLast(it.insert, it.back)}>
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}
