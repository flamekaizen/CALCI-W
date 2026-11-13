import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Delete } from 'lucide-react';
import { programmer } from '../../core/index';
import type { Base, WordSize, ProgSettings } from '../../core/programmer';
import { Segmented, copyText, haptic, useMediaQuery } from '../ui';
import '../../styles/modes/tools.css';

const { progEvaluate, toBase, bitsOf, toggleBit, wrap, floatBits, charOf } = programmer;

const BASES: { value: Base; label: string }[] = [
  { value: 16, label: 'HEX' },
  { value: 10, label: 'DEC' },
  { value: 8, label: 'OCT' },
  { value: 2, label: 'BIN' },
];

const PREFIX: Record<Base, string> = { 16: '0x', 10: '', 8: '0o', 2: '0b' };

export default function Programmer() {
  const [s, setS] = useState<ProgSettings>({ base: 10, word: 32, signed: true });
  const [input, setInput] = useState('');
  const [value, setValue] = useState<bigint>(0n);
  const [error, setError] = useState<string | null>(null);
  const [tape, setTape] = useState<{ expr: string; value: bigint; base: Base }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const coarse = useMediaQuery('(pointer: coarse)');

  const live = useMemo(() => {
    if (!input.trim()) return null;
    try {
      return progEvaluate(input, s, value);
    } catch {
      return null;
    }
  }, [input, s, value]);

  const shown = live ?? value;

  // keep the stored value valid when word size / signedness changes
  useEffect(() => setValue((v) => wrap(v, s.word, s.signed)), [s.word, s.signed]);

  const commit = () => {
    if (!input.trim()) return;
    try {
      const v = progEvaluate(input, s, value);
      setTape((t) => [{ expr: input, value: v, base: s.base }, ...t].slice(0, 50));
      setValue(v);
      setInput('');
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      haptic(20);
    }
  };

  const insert = (t: string) => {
    haptic();
    const el = inputRef.current;
    const start = el?.selectionStart ?? input.length;
    const end = el?.selectionEnd ?? input.length;
    let prefix = '';
    if (!input && /^\s*(AND|OR|XOR|NAND|NOR|XNOR|<<|>>|ROL|ROR|MOD|[+\-*/])\s*$/i.test(t)) prefix = 'ans';
    const next = input.slice(0, start) + prefix + t + input.slice(end);
    setInput(next);
    setError(null);
    const pos = start + prefix.length + t.length;
    requestAnimationFrame(() => {
      el?.setSelectionRange(pos, pos);
      if (!coarse) el?.focus();
    });
  };

  const setFromBits = (v: bigint) => {
    setValue(v);
    setInput('');
  };

  const digitsAllowed = (d: string) => {
    const n = parseInt(d, 16);
    return n < s.base;
  };

  const keys: { label: string; insert?: string; act?: () => void; cls?: string; disabled?: boolean; title?: string }[] = [
    { label: 'AND', insert: ' AND ', cls: 'fn' },
    { label: 'OR', insert: ' OR ', cls: 'fn' },
    { label: 'XOR', insert: ' XOR ', cls: 'fn' },
    { label: 'NOT', insert: 'NOT ', cls: 'fn' },
    { label: 'NAND', insert: ' NAND ', cls: 'fn' },
    { label: 'NOR', insert: ' NOR ', cls: 'fn' },
    { label: '<<', insert: ' << ', cls: 'fn', title: 'Shift left' },
    { label: '>>', insert: ' >> ', cls: 'fn', title: s.signed ? 'Arithmetic shift right' : 'Logical shift right' },
    { label: 'ROL', insert: ' ROL ', cls: 'fn', title: 'Rotate left' },
    { label: 'ROR', insert: ' ROR ', cls: 'fn', title: 'Rotate right' },
    { label: 'A', insert: 'A', cls: 'num', disabled: !digitsAllowed('A') },
    { label: 'B', insert: 'B', cls: 'num', disabled: !digitsAllowed('B') },
    { label: '(', insert: '(', cls: 'act' },
    { label: ')', insert: ')', cls: 'act' },
    { label: 'MOD', insert: ' MOD ', cls: 'fn' },
    { label: 'C', insert: 'C', cls: 'num', disabled: !digitsAllowed('C') },
    { label: 'D', insert: 'D', cls: 'num', disabled: !digitsAllowed('D') },
    { label: '⌫', act: () => setInput((t) => t.replace(/\s*(AND|OR|XOR|NOT|NAND|NOR|ROL|ROR|MOD)\s*$|.$/i, '')), cls: 'act', title: 'Delete' },
    { label: 'AC', act: () => (setInput(''), setValue(0n), setError(null)), cls: 'act', title: 'Clear' },
    { label: '÷', insert: ' / ', cls: 'op' },
    { label: 'E', insert: 'E', cls: 'num', disabled: !digitsAllowed('E') },
    { label: 'F', insert: 'F', cls: 'num', disabled: !digitsAllowed('F') },
    { label: '7', insert: '7', cls: 'num', disabled: !digitsAllowed('7') },
    { label: '8', insert: '8', cls: 'num', disabled: !digitsAllowed('8') },
    { label: '9', insert: '9', cls: 'num', disabled: !digitsAllowed('9') },
    { label: '×', insert: ' * ', cls: 'op' },
    { label: '±', act: () => (input ? insert('-') : setValue((v) => wrap(-v, s.word, s.signed))), cls: 'act', title: 'Negate' },
    { label: '4', insert: '4', cls: 'num', disabled: !digitsAllowed('4') },
    { label: '5', insert: '5', cls: 'num', disabled: !digitsAllowed('5') },
    { label: '6', insert: '6', cls: 'num', disabled: !digitsAllowed('6') },
    { label: '−', insert: ' - ', cls: 'op' },
    { label: 'Ans', insert: 'ans', cls: 'act' },
    { label: '1', insert: '1', cls: 'num' },
    { label: '2', insert: '2', cls: 'num', disabled: !digitsAllowed('2') },
    { label: '3', insert: '3', cls: 'num', disabled: !digitsAllowed('3') },
    { label: '+', insert: ' + ', cls: 'op' },
    { label: '0', insert: '0', cls: 'num' },
    { label: '=', act: commit, cls: 'eq' },
  ];

  const bits = bitsOf(shown, s.word);
  const fb = useMemo(() => {
    const n = Number(shown);
    return { f32: floatBits(n, 32), f64: floatBits(n, 64) };
  }, [shown]);

  return (
    <div className="page wide prog">
      <div className="row" style={{ marginBottom: 14 }}>
        <Segmented
          value={s.word}
          onChange={(word: WordSize) => setS({ ...s, word })}
          ariaLabel="Word size"
          options={[
            { value: 64 as WordSize, label: 'QWORD 64' },
            { value: 32 as WordSize, label: 'DWORD 32' },
            { value: 16 as WordSize, label: 'WORD 16' },
            { value: 8 as WordSize, label: 'BYTE 8' },
            { value: 128 as WordSize, label: '128' },
          ]}
        />
        <Segmented
          value={s.signed ? 's' : 'u'}
          onChange={(v) => setS({ ...s, signed: v === 's' })}
          ariaLabel="Signedness"
          options={[
            { value: 's', label: 'Signed' },
            { value: 'u', label: 'Unsigned' },
          ]}
        />
      </div>

      <div className="prog-grid">
        <div className="stack">
          <section className="card card-pad stack-sm">
            <div className="row">
              <span className="label">Input base</span>
              <Segmented value={s.base} onChange={(base) => setS({ ...s, base })} options={BASES} size="sm" ariaLabel="Input base" />
            </div>
            <input
              ref={inputRef}
              className="prog-input"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') setInput('');
              }}
              placeholder={`${toBase(value, s.base, s.word)}   (type e.g. FF AND 0F, 1 << 8, 0b1010 XOR 0x3)`}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="characters"
              inputMode={coarse ? 'none' : 'text'}
              aria-label="Programmer expression"
            />
            {error && <div className="error-text">{error}</div>}
            <div className="base-rows">
              {BASES.map((b) => (
                <button key={b.value} className={`base-row${s.base === b.value ? ' active' : ''}`} onClick={() => setS({ ...s, base: b.value })}>
                  <span className="base-label">{b.label}</span>
                  <span className="base-value num">{toBase(shown, b.value, s.word, { group: true })}</span>
                  <span
                    className="icon-btn sm"
                    role="button"
                    tabIndex={0}
                    aria-label={`Copy ${b.label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      copyText(PREFIX[b.value] + toBase(shown, b.value, s.word));
                    }}
                  >
                    <Copy size={14} />
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="card card-pad">
            <div className="row" style={{ marginBottom: 8 }}>
              <span className="section-title" style={{ margin: 0 }}>
                Bits
              </span>
              <span className="small muted">Click a bit to flip it</span>
            </div>
            <div className="bit-grid">
              {Array.from({ length: s.word / 4 }, (_, gi) => {
                const g = s.word / 4 - 1 - gi;
                return (
                  <div className="bit-group" key={g}>
                    <div className="bit-cells">
                      {[3, 2, 1, 0].map((o) => {
                        const i = g * 4 + o;
                        return (
                          <button
                            key={i}
                            className={`bit${bits[i] ? ' on' : ''}`}
                            onClick={() => setFromBits(toggleBit(shown, i, s))}
                            aria-label={`Bit ${i}: ${bits[i]}`}
                            title={`Bit ${i}`}
                          >
                            {bits[i]}
                          </button>
                        );
                      })}
                    </div>
                    <span className="bit-index">{g * 4}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="prog-keys" aria-label="Programmer keypad">
            {keys.map((k) => (
              <button
                key={k.label}
                className={`key key-${k.cls ?? 'fn'}`}
                disabled={k.disabled}
                title={k.title}
                onClick={() => (k.insert ? insert(k.insert) : k.act?.())}
              >
                {k.label === '⌫' ? <Delete size={18} /> : k.label}
              </button>
            ))}
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <div className="card-header">
              <h3>IEEE-754 floating point</h3>
            </div>
            <div className="card-body stack-sm">
              <FloatView title="Single (32-bit)" f={fb.f32} />
              <FloatView title="Double (64-bit)" f={fb.f64} />
              <p className="small muted">Shows how the current value is stored as a binary floating-point number.</p>
            </div>
          </section>
          <section className="card card-pad stack-sm">
            <div className="section-title">Character</div>
            <div className="row">
              <span className="char-preview">{charOf(shown) || '—'}</span>
              <div className="stack-sm small">
                <span>
                  Code point <code>U+{toBase(shown < 0n ? 0n : shown, 16, 32).padStart(4, '0')}</code>
                </span>
                <span className="muted">{shown >= 0n && shown < 128n ? 'ASCII' : shown <= 0x10ffffn && shown >= 0n ? 'Unicode' : 'Out of range'}</span>
              </div>
            </div>
          </section>
          {tape.length > 0 && (
            <section className="card">
              <div className="card-header">
                <h3>Tape</h3>
                <div className="spacer" />
                <button className="btn btn-ghost btn-sm" onClick={() => setTape([])}>
                  Clear
                </button>
              </div>
              <div className="tape">
                {tape.map((t, i) => (
                  <button key={i} className="tape-row" onClick={() => setInput(t.expr)}>
                    <span className="muted mono-sm">{t.expr}</span>
                    <span className="num">
                      = {PREFIX[t.base]}
                      {toBase(t.value, t.base, s.word)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function FloatView({ title, f }: { title: string; f: ReturnType<typeof floatBits> }) {
  return (
    <div className="float-view">
      <div className="row small">
        <strong>{title}</strong>
        <div className="spacer" />
        <code>0x{f.hex}</code>
        <span className="badge">{f.kind}</span>
      </div>
      <div className="float-bits" aria-label="Bit layout">
        <span className="fb sign" title="Sign">
          {f.bits[0]}
        </span>
        <span className="fb exp" title={`Exponent (unbiased ${f.exponent})`}>
          {f.exponentBits}
        </span>
        <span className="fb man" title="Mantissa / fraction">
          {f.mantissaBits}
        </span>
      </div>
      <div className="small muted">
        sign {f.sign} · exponent {f.exponent} · stored value {String(f.stored)}
      </div>
    </div>
  );
}
