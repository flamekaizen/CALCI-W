import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Eye, EyeOff, X, ZoomIn, ZoomOut, Home, Settings2, Share2, Download, Play, Pause, Ellipsis, AlertCircle, ChevronDown, ChevronUp, StickyNote, Code2, ImageDown } from 'lucide-react';
import { parse as mparse } from 'mathjs';
import { compileGraph, type CompiledItem, type GraphLine } from '../../../core/graph/parse';
import { renderSvg } from '../../../core/graph/svg';
import { CURVE_COLORS_LIGHT, adaptColor } from '../../../core/graph/palette';
import { normalizeInput, extractBraces, splitTopLevel } from '../../../core/normalize';
import { expressionTex } from '../../../core/format';
import { createMath } from '../../../core/math';
import { useStore, uid, DEFAULT_VIEW, type GraphExpr, type GraphView } from '../../store';
import { libraryLines } from '../../engine';
import { Tex, copyText, toast, useMediaQuery, useResolvedTheme, Segmented, NumberInput, fmtInput } from '../../ui';
import { GraphCanvas, type GraphCanvasHandle, type StyledItem } from './GraphCanvas';
import { PUBLIC_ORIGIN } from '../../platform';
import '../../../styles/modes/graph.css';

const texMath = createMath();
const OP_TEX: Record<string, string> = { '=': '=', '<': '<', '>': '>', '<=': '\\le', '>=': '\\ge' };

/** Pretty LaTeX for a graph line, or null if it can't be rendered. */
function lineTex(text: string): string | null {
  try {
    const norm = normalizeInput(text);
    const { expr, restrictions } = extractBraces(norm);
    const side = (s: string) => {
      const t = s.trim();
      if (/^\(.*\)$/.test(t)) {
        const inner = t.slice(1, -1);
        const parts = splitTopLevel(inner, ',');
        if (parts.length === 2) return `\\left(${parts.map((p) => expressionTex(texMath, mparse(p))).join(',\\ ')}\\right)`;
      }
      return expressionTex(texMath, mparse(t));
    };
    const m = expr.match(/^(.*?)(<=|>=|=|<|>)(.*)$/);
    let tex: string;
    if (m && !/[<>=]/.test(m[3])) tex = `${side(m[1])} ${OP_TEX[m[2]]} ${side(m[3])}`;
    else if (/^\(.*\)\s*,\s*\(/.test(expr)) tex = splitTopLevel(expr, ',').map((p) => side(p)).join(',\\ ');
    else tex = side(expr);
    if (restrictions.length) tex += `\\ \\left\\{${restrictions.map((r) => r.replace(/<=/g, '\\le ').replace(/>=/g, '\\ge ')).join(',\\ ')}\\right\\}`;
    return tex.replace(/\\mathrm{theta}/g, '\\theta');
  } catch {
    return null;
  }
}

/** Row id that should grab focus when it mounts (set when Enter creates a row). */
let pendingFocus: string | null = null;

const SLIDER_RE = /^\s*([A-Za-z_]\w*)\s*=\s*(-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?)\s*$/;

async function encodeState(obj: unknown): Promise<string> {
  const json = JSON.stringify(obj);
  try {
    const cs = new CompressionStream('deflate-raw');
    const stream = new Blob([json]).stream().pipeThrough(cs);
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = '';
    buf.forEach((b) => (bin += String.fromCharCode(b)));
    return 'z' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return 'j' + btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
}

async function decodeState(s: string): Promise<any> {
  const b64 = s.slice(1).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  if (s[0] === 'z') {
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    // read with a size cap so a crafted link can't act as a decompression bomb
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 1_000_000) {
        await reader.cancel();
        throw new Error('Shared graph is too large');
      }
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder().decode(await new Blob(chunks as BlobPart[]).arrayBuffer()));
  }
  return JSON.parse(decodeURIComponent(escape(bin)));
}

export default function GraphMode() {
  const graph = useStore((s) => s.graph);
  const library = useStore((s) => s.library);
  const setGraph = useStore((s) => s.setGraph);
  const setView = useStore((s) => s.setView);
  const addExpr = useStore((s) => s.addExpr);
  const [selected, setSelected] = useState<string | null>(graph.exprs[0]?.id ?? null);
  const [showSettings, setShowSettings] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const canvasRef = useRef<GraphCanvasHandle>(null);
  const narrow = useMediaQuery('(max-width: 860px)');
  const embed = typeof location !== 'undefined' && location.pathname.startsWith('/embed');
  const hideList = embed && new URLSearchParams(location.search).get('expressions') === 'hidden';
  const theme = useResolvedTheme();

  // load a shared graph from ?g=
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const g = p.get('g');
    if (!g) return;
    decodeState(g)
      .then((st) => {
        if (!Array.isArray(st?.e)) return;
        const exprs: GraphExpr[] = st.e.slice(0, 200).map((row: any[], i: number) => ({
          id: uid(),
          text: String(row[0] ?? '').slice(0, 2000),
          color: typeof row[1] === 'string' && /^#[0-9a-f]{6}$/i.test(row[1]) ? row[1] : CURVE_COLORS_LIGHT[i % 8],
          hidden: !!row[2],
          slider: row[3] && typeof row[3] === 'object' ? { min: +row[3][0], max: +row[3][1], step: +row[3][2] } : undefined,
        }));
        const v = st.v;
        const current = useStore.getState().graph.exprs.filter((e) => e.text.trim());
        const isDefault = current.length === 0 || current.map((e) => e.text).join('|') === 'y = sin(x)|y = a x^2 - 3|a = 0.5';
        if (!isDefault && !window.confirm('Open the shared graph? It will replace your current graph.')) {
          p.delete('g');
          history.replaceState(null, '', location.pathname + (p.toString() ? `?${p}` : ''));
          return;
        }
        setGraph({ exprs, view: v && [v.cx, v.cy, v.xspan].every(Number.isFinite) ? { cx: v.cx, cy: v.cy, xspan: v.xspan, yspan: Number.isFinite(v.yspan) ? v.yspan : null } : graph.view });
        toast('Shared graph loaded');
        p.delete('g');
        history.replaceState(null, '', location.pathname + (p.toString() ? `?${p}` : ''));
      })
      .catch(() => toast('Could not open that shared link'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const libLines = useMemo(() => libraryLines(), [library]);
  const compiled = useMemo(() => {
    const lines: GraphLine[] = graph.exprs.map((e) => ({ id: e.id, text: e.note ? '' : e.text, range: e.range }));
    return compileGraph(lines, { angle: graph.settings.angle, library: libLines });
  }, [graph.exprs, graph.settings.angle, libLines]);

  const styled: StyledItem[] = useMemo(
    () => compiled.items.map((item, i) => ({ item, color: graph.exprs[i].color, hidden: graph.exprs[i].hidden, style: graph.exprs[i].style, width: graph.exprs[i].width, fillOpacity: graph.exprs[i].fillOpacity })),
    [compiled, graph.exprs],
  );

  const exportPng = async () => {
    const blob = await canvasRef.current?.toPNG();
    if (!blob) return;
    download(blob, 'calci-graph.png');
  };
  const exportSvg = () => {
    const vp = canvasRef.current?.viewport();
    if (!vp) return;
    const visible = graph.exprs.filter((e, i) => !e.hidden && !e.note && compiled.items[i].kind !== 'error');
    const svg = renderSvg(
      graph.exprs.filter((e) => !e.note).map((e) => (e.hidden ? '' : e.text)),
      {
        width: Math.round(vp.width),
        height: Math.round(vp.height),
        xmin: vp.xmin,
        xmax: vp.xmax,
        ymin: vp.ymin,
        ymax: vp.ymax,
        theme,
        angle: graph.settings.angle,
        colors: graph.exprs.filter((e) => !e.note).map((e) => adaptColor(e.color, theme === 'dark')),
        piAxis: graph.settings.piX,
      },
    );
    void visible;
    download(new Blob([svg], { type: 'image/svg+xml' }), 'calci-graph.svg');
  };

  const shareState = () => ({
    e: graph.exprs.map((e) => [e.text, e.color, e.hidden ? 1 : 0, e.slider ? [e.slider.min, e.slider.max, e.slider.step] : 0]),
    v: graph.view,
  });

  return (
    <div className={`graph-mode${narrow ? ' narrow' : ''}${panelOpen ? '' : ' panel-closed'}${hideList ? ' no-list' : ''}`}>
      {!hideList && (
        <aside className="expr-panel" aria-label="Expressions">
          <div className="expr-toolbar">
            <button className="btn btn-ghost btn-sm" onClick={() => {
                const id = addExpr('');
                pendingFocus = id;
                setSelected(id);
              }}>
              <Plus size={15} /> Expression
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => {
                const id = addExpr('Note');
                useStore.getState().updateExpr(id, { note: true });
                setSelected(id);
              }} title="Add a text note">
              <StickyNote size={14} /> Note
            </button>
            <div className="spacer" />
            {narrow && (
              <button className="icon-btn sm" onClick={() => setPanelOpen((v) => !v)} aria-label={panelOpen ? 'Collapse expressions' : 'Expand expressions'}>
                {panelOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              </button>
            )}
          </div>
          <div className="expr-list">
            {graph.exprs.map((e, i) => (
              <ExprRow key={e.id} index={i} expr={e} item={compiled.items[i]} selected={selected === e.id} onSelect={() => setSelected(e.id)} />
            ))}
            <button className="expr-add" onClick={() => {
                const id = addExpr('');
                pendingFocus = id;
                setSelected(id);
              }}>
              <Plus size={15} /> Add expression
            </button>
            <div className="expr-help small muted">
              Try <code>y = x^2</code>, <code>x^2 + y^2 = 9</code>, <code>r = 2sin(4θ)</code>, <code>(cos t, sin 2t)</code>, <code>y &lt; |x|</code>,{' '}
              <code>{'y = x {0 < x < 3}'}</code> or <code>f(x) = …</code>. Unknown letters become sliders.
            </div>
          </div>
        </aside>
      )}

      <section className="graph-area">
        <GraphCanvas ref={canvasRef} items={styled} view={graph.view} settings={graph.settings} selectedId={selected} onViewCommit={setView} />
        <div className="graph-tools" role="toolbar" aria-label="Graph tools">
          <button className="icon-btn" onClick={() => canvasRef.current?.zoom(0.8)} aria-label="Zoom in" title="Zoom in">
            <ZoomIn size={18} />
          </button>
          <button className="icon-btn" onClick={() => canvasRef.current?.zoom(1.25)} aria-label="Zoom out" title="Zoom out">
            <ZoomOut size={18} />
          </button>
          <button className="icon-btn" onClick={() => setView(DEFAULT_VIEW)} aria-label="Default view" title="Default view">
            <Home size={18} />
          </button>
          <span className="tool-sep" />
          <button className={`icon-btn${showSettings ? ' active' : ''}`} onClick={() => (setShowSettings((v) => !v), setShowShare(false))} aria-label="Graph settings" title="Graph settings">
            <Settings2 size={18} />
          </button>
          {!embed && (
            <button className={`icon-btn${showShare ? ' active' : ''}`} onClick={() => (setShowShare((v) => !v), setShowSettings(false))} aria-label="Share and export" title="Share & export">
              <Share2 size={18} />
            </button>
          )}
        </div>
        {showSettings && <SettingsPopover onClose={() => setShowSettings(false)} viewport={() => canvasRef.current?.viewport()} />}
        {showShare && (
          <div className="graph-popover card">
            <div className="section-title">Share & export</div>
            <button
              className="btn btn-secondary"
              onClick={async () => {
                const code = await encodeState(shareState());
                copyText(`${PUBLIC_ORIGIN}/graph?g=${code}`, 'Link copied');
              }}
            >
              <Share2 size={15} /> Copy share link
            </button>
            <button className="btn btn-secondary" onClick={exportPng}>
              <ImageDown size={15} /> Download PNG
            </button>
            <button className="btn btn-secondary" onClick={exportSvg}>
              <Download size={15} /> Download SVG
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                const q = graph.exprs.filter((e) => e.text.trim() && !e.note).map((e) => `expr=${encodeURIComponent(e.text)}`).join('&');
                const vp = canvasRef.current?.viewport();
                const win = vp ? `&xmin=${+vp.xmin.toPrecision(6)}&xmax=${+vp.xmax.toPrecision(6)}` : '';
                copyText(`<iframe src="${PUBLIC_ORIGIN}/embed/graph?${q}${win}&theme=light" width="800" height="500" style="border:0;border-radius:12px" loading="lazy" title="Graph"></iframe>`, 'Embed code copied');
              }}
            >
              <Code2 size={15} /> Copy embed code
            </button>
            <p className="small muted">Links store the graph in the URL itself — nothing is uploaded.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const KIND_LABEL: Partial<Record<CompiledItem['kind'], string>> = {
  explicit: 'y = f(x)',
  explicitX: 'x = g(y)',
  polar: 'Polar',
  parametric: 'Parametric',
  implicit: 'Implicit',
  inequality: 'Inequality',
  points: 'Points',
  function: 'Function',
};

function ExprRow({ index, expr, item, selected, onSelect }: { index: number; expr: GraphExpr; item: CompiledItem; selected: boolean; onSelect: () => void }) {
  const updateExpr = useStore((s) => s.updateExpr);
  const removeExpr = useStore((s) => s.removeExpr);
  const addExpr = useStore((s) => s.addExpr);
  const angle = useStore((s) => s.graph.settings.angle);
  const theme = useResolvedTheme();
  const [focused, setFocused] = useState(false);
  const [menu, setMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tex = useMemo(() => (expr.note || focused || !expr.text.trim() ? null : lineTex(expr.text)), [expr.text, focused, expr.note]);
  const color = adaptColor(expr.color, theme === 'dark');
  const sliderMatch = expr.text.match(SLIDER_RE);
  const isSlider = item.kind === 'variable' && !!sliderMatch;
  const plottable = ['explicit', 'explicitX', 'polar', 'parametric', 'implicit', 'inequality', 'points'].includes(item.kind);

  useEffect(() => {
    if (pendingFocus === expr.id) {
      pendingFocus = null;
      inputRef.current?.focus();
    }
  }, [expr.id]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const id = addExpr('', expr.id);
      pendingFocus = id;
    } else if (e.key === 'Backspace' && !expr.text) {
      e.preventDefault();
      const prev = (e.currentTarget.closest('.expr-row')?.previousElementSibling as HTMLElement | null)?.querySelector<HTMLInputElement>('input[data-expr]');
      removeExpr(expr.id);
      prev?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const row = e.currentTarget.closest('.expr-row');
      const sib = (e.key === 'ArrowDown' ? row?.nextElementSibling : row?.previousElementSibling) as HTMLElement | null;
      const inp = sib?.querySelector<HTMLInputElement>('input[data-expr]');
      if (inp) {
        e.preventDefault();
        inp.focus();
      }
    }
  };

  if (expr.note) {
    return (
      <div className={`expr-row note${selected ? ' selected' : ''}`} onClick={onSelect}>
        <div className="expr-index">{index + 1}</div>
        <input data-expr={expr.id} className="expr-note" value={expr.text} onChange={(e) => updateExpr(expr.id, { text: e.target.value })} onFocus={onSelect} aria-label="Note" />
        <button className="icon-btn sm expr-del" onClick={() => removeExpr(expr.id)} aria-label="Delete note">
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className={`expr-row${selected ? ' selected' : ''}${item.kind === 'error' && expr.text.trim() ? ' has-error' : ''}`} onClick={onSelect}>
      <div className="expr-index">{index + 1}</div>
      <div className="expr-side">
        {plottable ? (
          <button
            className={`expr-swatch${expr.hidden ? ' off' : ''}`}
            style={{ '--c': color } as React.CSSProperties}
            onClick={(e) => {
              e.stopPropagation();
              updateExpr(expr.id, { hidden: !expr.hidden });
            }}
            aria-label={expr.hidden ? 'Show curve' : 'Hide curve'}
            title={expr.hidden ? 'Show' : 'Hide'}
          >
            {expr.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        ) : item.kind === 'error' && expr.text.trim() ? (
          <AlertCircle size={18} style={{ color: 'var(--danger)' }} />
        ) : null}
      </div>
      <div className="expr-body">
        <div className="expr-input-wrap" onClick={() => inputRef.current?.focus()}>
          <input
            ref={inputRef}
            data-expr={expr.id}
            className={`expr-input${tex ? ' has-tex' : ''}`}
            value={expr.text}
            onChange={(e) => updateExpr(expr.id, { text: e.target.value })}
            onFocus={() => {
              setFocused(true);
              onSelect();
            }}
            onBlur={() => setFocused(false)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-label={`Expression ${index + 1}`}
            placeholder={index === 0 ? 'Type an equation, e.g. y = x^2' : ''}
          />
          {tex && (
            <div className="expr-tex" aria-hidden>
              <Tex tex={tex} />
            </div>
          )}
        </div>
        {item.kind === 'error' && expr.text.trim() && (
          <div className="expr-error">
            {item.missing?.length ? (
              <>
                <span>Add slider:</span>
                {item.missing.map((m) => (
                  <button
                    key={m}
                    className="badge accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      const id = addExpr(`${m} = 1`, expr.id);
                      updateExpr(id, { slider: { min: -10, max: 10, step: 0.1 } });
                    }}
                  >
                    {m}
                  </button>
                ))}
              </>
            ) : (
              <span>{item.error}</span>
            )}
          </div>
        )}
        {item.kind === 'value' && Number.isFinite(item.value) && <div className="expr-value num">= {fmtInput(item.value!)}</div>}
        {item.kind === 'variable' && !isSlider && <div className="expr-value num">= {fmtInput(item.value!)}</div>}
        {isSlider && <SliderRow expr={expr} name={sliderMatch![1]} value={Number(sliderMatch![2])} />}
        {(item.kind === 'polar' || item.kind === 'parametric') && (
          <div className="expr-range">
            <span className="muted small">{item.kind === 'polar' ? 'θ' : 't'}:</span>
            <NumberInput className="range-input" value={item.range![0]} onChange={(v) => updateExpr(expr.id, { range: [v, item.range![1]] })} ariaLabel="Range start" />
            <span className="muted small">to</span>
            <NumberInput className="range-input" value={item.range![1]} onChange={(v) => updateExpr(expr.id, { range: [item.range![0], v] })} ariaLabel="Range end" />
            {angle !== 'rad' && item.kind === 'polar' && <span className="muted small">{angle}</span>}
          </div>
        )}
        {selected && plottable && KIND_LABEL[item.kind] && <div className="expr-kind">{KIND_LABEL[item.kind]}</div>}
      </div>
      <div className="expr-actions">
        <button className="icon-btn sm" onClick={(e) => (e.stopPropagation(), setMenu((m) => !m))} aria-label="Style options" title="Style">
          <Ellipsis size={15} />
        </button>
        <button className="icon-btn sm expr-del" onClick={(e) => (e.stopPropagation(), removeExpr(expr.id))} aria-label="Delete expression" title="Delete">
          <X size={15} />
        </button>
      </div>
      {menu && (
        <div className="expr-menu card" onClick={(e) => e.stopPropagation()}>
          <div className="swatches">
            {CURVE_COLORS_LIGHT.map((c) => (
              <button key={c} className={`swatch${expr.color === c ? ' active' : ''}`} style={{ background: adaptColor(c, theme === 'dark') }} onClick={() => updateExpr(expr.id, { color: c })} aria-label={`Colour ${c}`} />
            ))}
            <input type="color" value={expr.color} onChange={(e) => updateExpr(expr.id, { color: e.target.value })} aria-label="Custom colour" className="color-input" />
          </div>
          <Segmented
            size="sm"
            value={expr.style ?? 'solid'}
            onChange={(style) => updateExpr(expr.id, { style })}
            options={[
              { value: 'solid', label: 'Solid' },
              { value: 'dashed', label: 'Dashed' },
              { value: 'dotted', label: 'Dotted' },
            ]}
          />
          <label className="row small">
            Thickness
            <input type="range" min={1} max={8} step={0.5} value={expr.width ?? 2.5} onChange={(e) => updateExpr(expr.id, { width: Number(e.target.value) })} style={{ accentColor: 'var(--accent)', flex: 1 }} />
          </label>
          {item.kind === 'inequality' && (
            <label className="row small">
              Fill
              <input type="range" min={0} max={0.8} step={0.05} value={expr.fillOpacity ?? 0.2} onChange={(e) => updateExpr(expr.id, { fillOpacity: Number(e.target.value) })} style={{ accentColor: 'var(--accent)', flex: 1 }} />
            </label>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => setMenu(false)}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}

function SliderRow({ expr, name, value }: { expr: GraphExpr; name: string; value: number }) {
  const updateExpr = useStore((s) => s.updateExpr);
  const slider = expr.slider ?? { min: Math.min(-10, value), max: Math.max(10, value), step: 0.1 };
  const [playing, setPlaying] = useState(false);
  const dir = useRef(1);
  const valRef = useRef(value);
  valRef.current = value;
  const decimals = Math.max(0, Math.min(10, -Math.floor(Math.log10(slider.step || 1))));
  const setVal = (v: number) => updateExpr(expr.id, { text: `${name} = ${Number(v.toFixed(decimals))}`, slider });

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      let v = valRef.current + dir.current * (slider.max - slider.min) * 0.2 * dt;
      if (v >= slider.max) {
        v = slider.max;
        dir.current = -1;
      } else if (v <= slider.min) {
        v = slider.min;
        dir.current = 1;
      }
      valRef.current = v;
      updateExpr(expr.id, { text: `${name} = ${Number(v.toFixed(Math.max(decimals, 2)))}`, slider });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, slider.min, slider.max]);

  return (
    <div className="slider-row" onClick={(e) => e.stopPropagation()}>
      <button className="icon-btn sm" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Animate'} title={playing ? 'Pause' : 'Animate'}>
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <NumberInput className="slider-bound" value={slider.min} onChange={(min) => updateExpr(expr.id, { slider: { ...slider, min } })} ariaLabel={`${name} minimum`} />
      <input
        type="range"
        className="slider"
        min={slider.min}
        max={slider.max}
        step={slider.step || 'any'}
        value={value}
        onChange={(e) => setVal(Number(e.target.value))}
        aria-label={`${name} value`}
      />
      <NumberInput className="slider-bound" value={slider.max} onChange={(max) => updateExpr(expr.id, { slider: { ...slider, max } })} ariaLabel={`${name} maximum`} />
    </div>
  );
}

function SettingsPopover({ onClose, viewport }: { onClose: () => void; viewport: () => { xmin: number; xmax: number; ymin: number; ymax: number } | undefined }) {
  const settings = useStore((s) => s.graph.settings);
  const setSettings = useStore((s) => s.setGraphSettings);
  const setView = useStore((s) => s.setView);
  const vp = viewport();
  const [win, setWin] = useState(() => (vp ? { ...vp } : { xmin: -10, xmax: 10, ymin: -6, ymax: 6 }));
  const [square, setSquare] = useState(true);
  const applyWindow = (w: typeof win, sq: boolean) => {
    if (!(w.xmax > w.xmin) || !(w.ymax > w.ymin)) return;
    const v: GraphView = { cx: (w.xmin + w.xmax) / 2, cy: (w.ymin + w.ymax) / 2, xspan: w.xmax - w.xmin, yspan: sq ? null : w.ymax - w.ymin };
    setView(v);
  };
  const check = (key: keyof typeof settings, label: string) => (
    <label className="checkbox">
      <input type="checkbox" checked={!!settings[key]} onChange={(e) => setSettings({ [key]: e.target.checked } as any)} />
      {label}
    </label>
  );
  return (
    <div className="graph-popover card" role="dialog" aria-label="Graph settings">
      <div className="row">
        <div className="section-title" style={{ margin: 0 }}>
          Graph settings
        </div>
        <div className="spacer" />
        <button className="icon-btn sm" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>
      <div className="stack-sm">
        {check('grid', 'Grid')}
        {check('minor', 'Minor gridlines')}
        {check('polarGrid', 'Polar grid')}
        {check('axes', 'Axes')}
        {check('labels', 'Axis numbers')}
        {check('piX', 'x-axis in multiples of π')}
        {check('poi', 'Points of interest (roots, extrema, intersections)')}
      </div>
      <div className="label">Angle unit for trig functions</div>
      <Segmented
        size="sm"
        value={settings.angle}
        onChange={(angle) => setSettings({ angle })}
        options={[
          { value: 'rad', label: 'Radians' },
          { value: 'deg', label: 'Degrees' },
        ]}
      />
      <div className="label">Window</div>
      <div className="window-grid">
        {(['xmin', 'xmax', 'ymin', 'ymax'] as const).map((k) => (
          <label key={k} className="field">
            <span className="small muted">{k}</span>
            <NumberInput value={win[k]} onChange={(v) => setWin((w) => ({ ...w, [k]: v }))} ariaLabel={k} />
          </label>
        ))}
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={square} onChange={(e) => setSquare(e.target.checked)} />
        Keep square units (ignore y range)
      </label>
      <button className="btn btn-primary btn-sm" onClick={() => applyWindow(win, square)}>
        Apply window
      </button>
    </div>
  );
}
