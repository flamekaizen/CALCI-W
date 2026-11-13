import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Settings, Sun, Moon, PanelLeft, X, Monitor, LayoutGrid, CornerDownLeft, Calculator as CalcIcon, Sparkles } from 'lucide-react';
import { MODES, MODE_GROUPS, findMode, type ModeDef } from './modes';
import { navigate, useRoute } from './router';
import { useStore, type Accent, type Theme } from './store';
import { getCalculator } from './engine';
import { Segmented, ToastHost, copyText, useMediaQuery, useResolvedTheme, Tex, toast } from './ui';
import { initEmbedBridge } from '../embed/bridge';
import { initNative, syncNativeTheme } from './platform';

const ACCENTS: { id: Accent; color: string; label: string }[] = [
  { id: 'indigo', color: '#4f46e5', label: 'Indigo' },
  { id: 'teal', color: '#0f766e', label: 'Teal' },
  { id: 'sky', color: '#0369a1', label: 'Sky' },
  { id: 'emerald', color: '#059669', label: 'Emerald' },
  { id: 'amber', color: '#c2620a', label: 'Amber' },
  { id: 'rose', color: '#e11d48', label: 'Rose' },
];

const PRIMARY_TABS = ['scientific', 'graph', 'solver', 'stats'];

export default function App() {
  const route = useRoute();
  const mode = findMode(route.mode) ?? MODES[0];
  const navCollapsed = useStore((s) => s.navCollapsed);
  const accent = useStore((s) => s.accent);
  const touchMode = useStore((s) => s.touchMode);
  const resolved = useResolvedTheme();
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState(false);
  const [sheet, setSheet] = useState(false);
  const embed = route.embed;

  // embed overrides via query (?theme=dark&accent=teal)
  const qTheme = route.params.get('theme');
  const qAccent = route.params.get('accent');
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = embed && (qTheme === 'dark' || qTheme === 'light') ? qTheme : resolved;
    root.dataset.accent = embed && qAccent ? qAccent : accent;
    const meta = document.querySelector('meta[name="theme-color"]');
    const bar = root.dataset.theme === 'dark' ? '#0e1117' : '#fbfbfc';
    meta?.setAttribute('content', bar);
    syncNativeTheme(root.dataset.theme === 'dark' ? 'dark' : 'light', bar);
  }, [resolved, accent, embed, qTheme, qAccent]);

  useEffect(() => {
    touchMode(mode.id);
    document.title = embed ? `Calci ${mode.label}` : `${mode.label} · Calci`;
  }, [mode.id, embed, mode.label, touchMode]);

  useEffect(() => {
    if (embed) return initEmbedBridge();
  }, [embed]);

  useEffect(() => initNative(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      } else if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setSettings(true);
      } else if (e.altKey && /^[1-9]$/.test(e.key)) {
        const m = MODES[Number(e.key) - 1];
        if (m) {
          e.preventDefault();
          navigate(m.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const Mode = mode.component;

  if (embed) {
    return (
      <div className="app embed">
        <main className="main">
          <div className={`content${mode.fill ? ' fill' : ''}`}>
            <Suspense fallback={<Loading />}>
              <Mode />
            </Suspense>
          </div>
        </main>
        <ToastHost />
      </div>
    );
  }

  return (
    <div className={`app${navCollapsed ? ' nav-collapsed' : ''}`}>
      <Nav current={mode.id} />
      <main className="main">
        <Header mode={mode} onPalette={() => setPalette(true)} onSettings={() => setSettings(true)} />
        <div className={`content${mode.fill ? ' fill' : ''}`}>
          <Suspense fallback={<Loading />}>
            <Mode />
          </Suspense>
        </div>
      </main>
      <nav className="tabbar" aria-label="Modes">
        {PRIMARY_TABS.map((id) => {
          const m = findMode(id)!;
          const Icon = m.icon;
          return (
            <button key={id} className={mode.id === id ? 'active' : ''} onClick={() => navigate(id)} aria-current={mode.id === id ? 'page' : undefined}>
              <Icon size={21} strokeWidth={1.9} />
              {m.short}
            </button>
          );
        })}
        <button className={!PRIMARY_TABS.includes(mode.id) ? 'active' : ''} onClick={() => setSheet(true)}>
          <LayoutGrid size={21} strokeWidth={1.9} />
          More
        </button>
      </nav>
      {sheet && (
        <div className="overlay" style={{ alignItems: 'flex-end', padding: 0 }} onClick={() => setSheet(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="All modes">
            <div className="sheet-handle" />
            <div className="sheet-grid">
              {MODES.map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.id}
                    className={m.id === mode.id ? 'active' : ''}
                    onClick={() => {
                      navigate(m.id);
                      setSheet(false);
                    }}
                  >
                    <Icon size={22} strokeWidth={1.8} />
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {palette && <CommandPalette onClose={() => setPalette(false)} onSettings={() => setSettings(true)} />}
      {settings && <SettingsDrawer onClose={() => setSettings(false)} />}
      <ToastHost />
    </div>
  );
}

function Loading() {
  return (
    <div className="empty" style={{ height: '100%' }}>
      <div className="spinner" aria-label="Loading" />
    </div>
  );
}

function Nav({ current }: { current: string }) {
  const set = useStore((s) => s.set);
  const collapsed = useStore((s) => s.navCollapsed);
  return (
    <nav className="nav" aria-label="Modes">
      <div className="nav-brand">
        <span className="brand-mark" aria-hidden>
          <BrandGlyph />
        </span>
        <span className="nav-brand-text">Calci</span>
      </div>
      {MODE_GROUPS.map((g) => (
        <div key={g}>
          <div className="nav-section">{g}</div>
          {MODES.filter((m) => m.group === g).map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                className={`nav-item${m.id === current ? ' active' : ''}`}
                onClick={() => navigate(m.id)}
                title={collapsed ? m.label : m.description}
                aria-current={m.id === current ? 'page' : undefined}
              >
                <Icon size={19} strokeWidth={1.85} />
                <span className="nav-label">{m.label}</span>
              </button>
            );
          })}
        </div>
      ))}
      <div className="nav-spacer" />
      <button className="nav-item" onClick={() => set({ navCollapsed: !collapsed })} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        <PanelLeft size={19} strokeWidth={1.85} />
        <span className="nav-label">Collapse</span>
      </button>
    </nav>
  );
}

export function BrandGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden>
      <path d="M4 15c2.5 0 3.5-9 7-9s3 12 9 12" />
      <path d="M4 20h16" opacity={0.55} />
    </svg>
  );
}

function Header({ mode, onPalette, onSettings }: { mode: ModeDef; onPalette: () => void; onSettings: () => void }) {
  const theme = useStore((s) => s.theme);
  const set = useStore((s) => s.set);
  const resolved = useResolvedTheme();
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const Icon = mode.icon;
  const narrow = useMediaQuery('(max-width: 860px)');
  return (
    <header className="header">
      {narrow ? (
        <span className="brand-mark" aria-hidden style={{ width: 28, height: 28 }}>
          <BrandGlyph size={16} />
        </span>
      ) : (
        <Icon size={20} strokeWidth={1.85} style={{ color: 'var(--accent-text)', flex: '0 0 auto' }} />
      )}
      <div className="header-title">
        <h1>{mode.label}</h1>
        <p>{mode.description}</p>
      </div>
      <div className="header-actions">
        <button className="search-trigger" onClick={onPalette} aria-label="Search and quick calculate">
          <Search size={15} />
          <span className="search-text">Search or calculate…</span>
          <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
        </button>
        <button
          className="icon-btn"
          aria-label="Toggle theme"
          title={`Theme: ${theme}`}
          onClick={() => set({ theme: resolved === 'dark' ? 'light' : 'dark' } as { theme: Theme })}
        >
          {resolved === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button className="icon-btn" aria-label="Settings" title="Settings" onClick={onSettings}>
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ command palette */
interface PaletteItem {
  id: string;
  group: string;
  label: string;
  sub?: string;
  icon?: React.ReactNode;
  run: () => void;
}

function CommandPalette({ onClose, onSettings }: { onClose: () => void; onSettings: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const st = useStore();
  useEffect(() => inputRef.current?.focus(), []);

  const result = useMemo(() => {
    if (!q.trim() || /^[a-z ]+$/i.test(q.trim())) return null;
    return getCalculator().preview(q);
  }, [q]);

  const items: PaletteItem[] = useMemo(() => {
    const all: PaletteItem[] = [
      ...MODES.map((m) => {
        const Icon = m.icon;
        return { id: `mode:${m.id}`, group: 'Go to', label: m.label, sub: m.description, icon: <Icon size={17} />, run: () => navigate(m.id), _k: `${m.label} ${m.keywords}` } as PaletteItem & { _k: string };
      }),
      { id: 'act:theme', group: 'Actions', label: 'Toggle dark mode', icon: <Moon size={17} />, run: () => st.set({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }) },
      { id: 'act:system', group: 'Actions', label: 'Use system theme', icon: <Monitor size={17} />, run: () => st.set({ theme: 'system' }) },
      { id: 'act:deg', group: 'Actions', label: 'Angle unit: degrees', icon: <CalcIcon size={17} />, run: () => st.setCalc({ angle: 'deg' }) },
      { id: 'act:rad', group: 'Actions', label: 'Angle unit: radians', icon: <CalcIcon size={17} />, run: () => st.setCalc({ angle: 'rad' }) },
      { id: 'act:settings', group: 'Actions', label: 'Open settings', icon: <Settings size={17} />, run: onSettings },
      { id: 'act:history', group: 'Actions', label: 'Clear calculation history', icon: <X size={17} />, run: () => (st.clearHistory(), toast('History cleared')) },
    ];
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((it) => {
      const hay = `${it.label} ${(it as any)._k ?? ''} ${it.sub ?? ''}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [q, st, onSettings]);

  useEffect(() => setActive(0), [q]);

  const runItem = (it?: PaletteItem) => {
    if (!it) return;
    it.run();
    onClose();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Search size={18} className="muted" />
          <input
            ref={inputRef}
            value={q}
            placeholder="Search modes, actions — or type a calculation like 2^10 or 5 km to mi"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                if (result) {
                  copyText(result.text, `Copied ${result.text}`);
                  onClose();
                } else runItem(items[active]);
              }
            }}
            aria-label="Search"
          />
          <kbd>Esc</kbd>
        </div>
        {result && (
          <div className="palette-result">
            <Sparkles size={17} style={{ color: 'var(--accent-text)' }} />
            <div style={{ flex: 1, minWidth: 0, overflowX: 'auto' }}>
              <Tex tex={result.tex} />
            </div>
            <span className="small muted row nowrap">
              <CornerDownLeft size={13} /> copy
            </span>
          </div>
        )}
        <div className="palette-list" role="listbox">
          {items.length === 0 && !result && <div className="empty">No matches</div>}
          {items.map((it, i) => (
            <div key={it.id}>
              {(i === 0 || items[i - 1].group !== it.group) && <div className="palette-group">{it.group}</div>}
              <button className={`palette-item${i === active ? ' active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => runItem(it)} role="option" aria-selected={i === active}>
                {it.icon}
                <div style={{ minWidth: 0 }}>
                  <div>{it.label}</div>
                  {it.sub && <div className="sub">{it.sub}</div>}
                </div>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ settings */
function SettingsDrawer({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <>
      <div className="overlay" style={{ padding: 0 }} onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Settings">
        <div className="drawer-header">
          <h2>Settings</h2>
          <div className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="Close settings">
            <X size={18} />
          </button>
        </div>
        <div className="drawer-body">
          <section className="stack-sm">
            <div className="section-title">Appearance</div>
            <Segmented
              value={s.theme}
              onChange={(theme) => s.set({ theme })}
              ariaLabel="Theme"
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                { value: 'system', label: 'System' },
              ]}
            />
            <div className="label" style={{ marginTop: 8 }}>
              Accent colour
            </div>
            <div className="swatches">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  className={`swatch${s.accent === a.id ? ' active' : ''}`}
                  style={{ background: a.color }}
                  onClick={() => s.set({ accent: a.id })}
                  aria-label={a.label}
                  title={a.label}
                />
              ))}
            </div>
          </section>

          <section className="stack-sm">
            <div className="section-title">Calculation</div>
            <div className="label">Angle unit</div>
            <Segmented
              value={s.calc.angle}
              onChange={(angle) => s.setCalc({ angle })}
              ariaLabel="Angle unit"
              options={[
                { value: 'deg', label: 'Degrees' },
                { value: 'rad', label: 'Radians' },
                { value: 'grad', label: 'Gradians' },
              ]}
            />
            <div className="label" style={{ marginTop: 6 }}>
              Number display
            </div>
            <Segmented
              value={s.calc.notation}
              onChange={(notation) => s.setCalc({ notation })}
              ariaLabel="Number display"
              options={[
                { value: 'auto', label: 'Auto', title: 'Normal display' },
                { value: 'fix', label: 'Fixed', title: 'Fixed decimal places' },
                { value: 'sci', label: 'Scientific' },
                { value: 'eng', label: 'Engineering' },
              ]}
            />
            <div className="row" style={{ marginTop: 6 }}>
              <span className="label">{s.calc.notation === 'fix' ? 'Decimal places' : 'Significant digits'}</span>
              <div className="spacer" />
              <input
                type="range"
                min={s.calc.notation === 'fix' ? 0 : 1}
                max={s.calc.bignumber ? 60 : s.calc.notation === 'fix' ? 15 : 16}
                value={s.calc.digits}
                onChange={(e) => s.setCalc({ digits: Number(e.target.value) })}
                aria-label="Digits"
                style={{ accentColor: 'var(--accent)' }}
              />
              <span className="badge num">{s.calc.digits}</span>
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={s.calc.grouping} onChange={(e) => s.setCalc({ grouping: e.target.checked })} />
              Group digits (1,234,567)
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={s.exactDefault} onChange={(e) => s.set({ exactDefault: e.target.checked })} />
              Show exact answers (fractions, √, π) when possible
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={s.calc.bignumber} onChange={(e) => s.setCalc({ bignumber: e.target.checked, digits: e.target.checked ? 30 : 12 })} />
              High-precision arithmetic (up to 64 digits)
            </label>
          </section>

          <section className="stack-sm">
            <div className="section-title">Device</div>
            <label className="checkbox">
              <input type="checkbox" checked={s.haptics} onChange={(e) => s.set({ haptics: e.target.checked })} />
              Haptic feedback on keypad (supported phones)
            </label>
          </section>

          <section className="stack-sm">
            <div className="section-title">Keyboard shortcuts</div>
            <div className="small muted stack-sm">
              <div className="row"><kbd>Ctrl</kbd>+<kbd>K</kbd> Search & quick calculate</div>
              <div className="row"><kbd>Alt</kbd>+<kbd>1</kbd>…<kbd>9</kbd> Switch mode</div>
              <div className="row"><kbd>Enter</kbd> Evaluate · <kbd>Esc</kbd> Clear · <kbd>↑</kbd> Recall history</div>
              <div className="row"><kbd>Ctrl</kbd>+<kbd>,</kbd> Settings</div>
            </div>
          </section>

          <section className="stack-sm">
            <div className="section-title">Data</div>
            <p className="small muted">Everything you create is stored on this device only. Nothing is sent to a server.</p>
            {!confirmReset ? (
              <button className="btn btn-secondary" onClick={() => setConfirmReset(true)}>
                Reset all data…
              </button>
            ) : (
              <div className="row">
                <span className="small">Erase history, graphs, scripts and settings?</span>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    try {
                      localStorage.removeItem('calci-state-v1');
                    } catch {
                      /* ignore */
                    }
                    location.reload();
                  }}
                >
                  Erase
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirmReset(false)}>
                  Cancel
                </button>
              </div>
            )}
          </section>

          <section className="small muted">
            Calci v1.0 · Built on open-source software (math.js, KaTeX, CodeMirror, React).{' '}
            <a href="/licenses.txt" target="_blank" rel="noreferrer">
              Licences
            </a>
          </section>
        </div>
      </aside>
    </>
  );
}
