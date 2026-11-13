import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import katex from 'katex';
import { create } from 'zustand';
import { Check, Copy } from 'lucide-react';
import { getCalculator } from './engine';
import { toNumber } from '../core/index';
import { useStore } from './store';
import { nativeHaptic } from './platform';

/* ------------------------------------------------------------------ KaTeX */
export function Tex({ tex, display = false, className }: { tex: string; display?: boolean; className?: string }) {
  const html = useMemo(() => {
    if (!tex) return '';
    try {
      return katex.renderToString(tex, { throwOnError: false, displayMode: display, output: 'html', strict: 'ignore', trust: false });
    } catch {
      return '';
    }
  }, [tex, display]);
  if (!html) return <span className={className}>{tex}</span>;
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

/* ------------------------------------------------------------------ controls */
export function Segmented<T extends string | number>({
  value, options, onChange, size, ariaLabel,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: 'sm';
  ariaLabel?: string;
}) {
  return (
    <div className={`segmented${size ? ` ${size}` : ''}`} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'active' : ''}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { id: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === value} className={t.id === value ? 'active' : ''} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/** Evaluate a short expression to a number (accepts "2pi", "1e3", "sqrt(2)", "-Infinity"). */
export function parseNumber(text: string): number {
  const t = text.trim();
  if (!t) return NaN;
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return Number(t);
  try {
    const r = getCalculator().preview(t);
    return r ? toNumber(r.value) : NaN;
  } catch {
    return NaN;
  }
}

/**
 * Number input that accepts expressions. Calls onChange with the parsed value
 * as the user types (when valid) and keeps the raw text locally.
 */
export function NumberInput({
  value, onChange, id, placeholder, className = '', allowEmpty, ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  id?: string;
  placeholder?: string;
  className?: string;
  allowEmpty?: boolean;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(() => (Number.isFinite(value) || !allowEmpty ? fmtInput(value) : ''));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current && !(Number.isNaN(value) && Number.isNaN(last.current))) {
      last.current = value;
      setText(Number.isFinite(value) || !allowEmpty ? fmtInput(value) : '');
    }
  }, [value, allowEmpty]);
  const parsed = parseNumber(text);
  const invalid = text.trim() !== '' && Number.isNaN(parsed);
  return (
    <input
      id={id}
      aria-label={ariaLabel}
      className={`input num ${invalid ? 'invalid' : ''} ${className}`}
      value={text}
      inputMode="decimal"
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseNumber(e.target.value);
        if (!Number.isNaN(v) || (allowEmpty && !e.target.value.trim())) {
          last.current = v;
          onChange(v);
        }
      }}
    />
  );
}

export function fmtInput(v: number): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? '' : v > 0 ? 'Infinity' : '-Infinity';
  return String(Number(v.toPrecision(12)));
}

/** Compact number display for tables and tiles. */
export function fmt(v: number, digits = 8): string {
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e12 || a < 1e-6) return v.toExponential(Math.max(1, digits - 3)).replace(/\.?0+e/, 'e');
  return Number(v.toPrecision(digits)).toLocaleString(undefined, { maximumFractionDigits: 10 });
}

export function money(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ------------------------------------------------------------------ toasts */
interface ToastState {
  toasts: { id: number; text: string }[];
  push: (text: string) => void;
}
let toastId = 0;
export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (text) => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, text }].slice(-3) });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 2200);
  },
}));
export const toast = (text: string) => useToasts.getState().push(text);

export function ToastHost() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          <Check size={15} />
          {t.text}
        </div>
      ))}
    </div>
  );
}

export async function copyText(text: string, label = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast(label);
    } finally {
      ta.remove();
    }
  }
}

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <pre className="code-block" data-lang={lang}>
      <button className="icon-btn sm copy" aria-label="Copy code" title="Copy" onClick={() => copyText(code)}>
        <Copy size={14} />
      </button>
      {code}
    </pre>
  );
}

/* ------------------------------------------------------------------ hooks */
export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const h = () => setM(mq.matches);
    mq.addEventListener('change', h);
    h();
    return () => mq.removeEventListener('change', h);
  }, [q]);
  return m;
}

export function useResolvedTheme(): 'light' | 'dark' {
  const theme = useStore((s) => s.theme);
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  return theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
}

/** Observe an element's size. */
export function useSize<T extends HTMLElement>(): [React.RefObject<T>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect;
      setSize((s) => (s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

export function haptic(ms = 8) {
  if (!useStore.getState().haptics) return;
  if (nativeHaptic(ms > 12 ? 'MEDIUM' : 'LIGHT')) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}

/** Read theme colours from CSS variables (for canvas rendering). */
export function cssVar(name: string, el: Element = document.documentElement): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}
