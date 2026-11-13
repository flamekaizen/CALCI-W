/**
 * Textbook ("natural display") math input built on MathLive: fractions stack,
 * roots get a radical, exponents rise, templates have empty boxes to fill —
 * like the input line of a Casio ClassWiz or TI MathPrint calculator.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { MathfieldElement } from 'mathlive';

export interface MathInputHandle {
  /** Insert LaTeX at the caret. #? = empty box, #@ = current selection / previous term. */
  insert: (latex: string) => void;
  command: (cmd: string | [string, ...unknown[]]) => void;
  getValue: () => string;
  setValue: (latex: string) => void;
  focus: () => void;
  blur: () => void;
  isEmpty: () => boolean;
  showKeyboard: () => void;
  hideKeyboard: () => void;
}

interface Props {
  value?: string;
  onChange?: (latex: string) => void;
  onEnter?: () => void;
  /** Called on keydown before MathLive handles it; return true to swallow the key. */
  onKey?: (e: KeyboardEvent, mf: MathfieldElement) => boolean | void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}

let loader: Promise<typeof import('mathlive')> | null = null;
function loadMathLive() {
  loader ??= import('mathlive').then((m) => {
    try {
      m.MathfieldElement.fontsDirectory = new URL('mathlive/fonts/', document.baseURI).href;
      m.MathfieldElement.soundsDirectory = null;
      m.MathfieldElement.keypressSound = null;
      m.MathfieldElement.plonkSound = null;
    } catch {
      /* older/newer API */
    }
    return m;
  });
  return loader;
}

export const MathInput = forwardRef<MathInputHandle, Props>(function MathInput(
  { value, onChange, onEnter, onKey, placeholder, className, ariaLabel = 'Math input', autoFocus },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const mfRef = useRef<MathfieldElement | null>(null);
  const [failed, setFailed] = useState(false);
  const handlers = useRef({ onChange, onEnter, onKey });
  handlers.current = { onChange, onEnter, onKey };

  useEffect(() => {
    let cancelled = false;
    loadMathLive()
      .then(({ MathfieldElement }) => {
        if (cancelled || !host.current) return;
        const mf = new MathfieldElement();
        mf.mathVirtualKeyboardPolicy = 'manual';
        mf.setAttribute('aria-label', ariaLabel);
        if (placeholder) mf.setAttribute('placeholder', placeholder);
        mf.className = 'math-input-field';
        // some options can only be set once the field is mounted
        host.current.appendChild(mf);
        const opt = (fn: () => void) => {
          try {
            fn();
          } catch {
            /* option not supported by this MathLive version */
          }
        };
        opt(() => (mf.smartFence = true));
        opt(() => (mf.smartSuperscript = true));
        opt(() => (mf.defaultMode = 'math'));
        opt(() => (mf.letterShapeStyle = 'tex'));
        opt(() => (mf.menuItems = []));
        // Casio-like shortcuts on top of MathLive's defaults
        opt(
          () =>
            (mf.inlineShortcuts = {
              ...mf.inlineShortcuts,
              pi: '\\pi',
              theta: '\\theta',
              sqrt: '\\sqrt{#?}',
              cbrt: '\\sqrt[3]{#?}',
              inf: '\\infty',
              ans: '\\operatorname{ans}',
              deg: '^{\\circ}',
              '<=': '\\le',
              '>=': '\\ge',
              '!=': '\\ne',
            }),
        );
        if (value) mf.value = value;
        mf.addEventListener('input', () => handlers.current.onChange?.(mf.value));
        mf.addEventListener(
          'keydown',
          (e: KeyboardEvent) => {
            if (handlers.current.onKey?.(e, mf)) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.stopPropagation();
              handlers.current.onEnter?.();
            }
          },
          { capture: true },
        );
        mfRef.current = mf;
        if (autoFocus) requestAnimationFrame(() => mf.focus());
      })
      .catch((e) => {
        console.error('Calci: textbook editor failed to load', e);
        setFailed(true);
      });
    return () => {
      cancelled = true;
      mfRef.current?.remove();
      mfRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // external value updates (e.g. cleared after evaluation, history recall)
  useEffect(() => {
    const mf = mfRef.current;
    if (mf && value !== undefined && mf.value !== value) mf.value = value;
  }, [value]);

  useImperativeHandle(ref, () => ({
    insert: (latex) => {
      const mf = mfRef.current;
      if (!mf) return;
      mf.executeCommand(['insert', latex, { selectionMode: 'placeholder', format: 'latex', focus: false }] as any);
      handlers.current.onChange?.(mf.value);
    },
    command: (cmd) => {
      const mf = mfRef.current;
      if (!mf) return;
      mf.executeCommand(cmd as any);
      handlers.current.onChange?.(mf.value);
    },
    getValue: () => mfRef.current?.value ?? '',
    setValue: (latex) => {
      if (mfRef.current) mfRef.current.value = latex;
    },
    focus: () => mfRef.current?.focus(),
    blur: () => mfRef.current?.blur(),
    isEmpty: () => !(mfRef.current?.value ?? '').trim(),
    showKeyboard: () => {
      const mf = mfRef.current;
      if (!mf) return;
      mf.focus();
      (window as any).mathVirtualKeyboard?.show({ animate: true });
    },
    hideKeyboard: () => (window as any).mathVirtualKeyboard?.hide(),
  }));

  if (failed) return <div className="muted small">The textbook editor could not load. Switch to linear input in the display bar.</div>;
  return <div ref={host} className={`math-input ${className ?? ''}`} />;
});
