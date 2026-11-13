import { useMemo, useState } from 'react';
import { X, Plus, Replace } from 'lucide-react';
import { GRAPH_EXAMPLES, type GraphExample } from './examples';
import { renderSvg } from '../../../core/graph/svg';
import { CURVE_COLORS_LIGHT } from '../../../core/graph/palette';
import { useStore, uid, type GraphExpr } from '../../store';
import { toast, useResolvedTheme } from '../../ui';

function thumb(ex: GraphExample, dark: boolean): string {
  try {
    const svg = renderSvg(
      ex.exprs.map((e) => (typeof e === 'string' ? e : e.text)),
      { width: 260, height: 150, xmin: ex.view?.xmin ?? -10, xmax: ex.view?.xmax ?? 10, ymin: ex.view?.ymin, ymax: ex.view?.ymax, theme: dark ? 'dark' : 'light', lineWidth: 2 },
    );
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } catch {
    return '';
  }
}

function toExprs(ex: GraphExample, existing: GraphExpr[]): GraphExpr[] {
  const used = new Set(existing.map((e) => e.color));
  const palette = CURVE_COLORS_LIGHT.filter((c) => !used.has(c));
  return ex.exprs.map((e, i) => {
    const o = typeof e === 'string' ? { text: e } : e;
    return {
      id: uid(),
      text: o.text,
      color: palette[i % Math.max(1, palette.length)] ?? CURVE_COLORS_LIGHT[i % 8],
      range: o.range,
      slider: o.slider,
    };
  });
}

/** Apply an example to the graph (append or replace) and move the view. */
export function applyExample(ex: GraphExample, mode: 'add' | 'replace') {
  const st = useStore.getState();
  const current = st.graph.exprs.filter((e) => e.text.trim());
  const added = toExprs(ex, mode === 'add' ? current : []);
  const exprs = mode === 'add' ? [...current, ...added] : added;
  const v = ex.view;
  st.setGraph({
    exprs: [...exprs, { id: uid(), text: '', color: CURVE_COLORS_LIGHT[exprs.length % 8] }],
    view: v ? { cx: (v.xmin + v.xmax) / 2, cy: v.ymin !== undefined && v.ymax !== undefined ? (v.ymin + v.ymax) / 2 : 0, xspan: v.xmax - v.xmin, yspan: v.ymin !== undefined && v.ymax !== undefined ? v.ymax - v.ymin : null } : { cx: 0, cy: 0, xspan: 20, yspan: null },
  });
  toast(mode === 'add' ? `Added “${ex.title}”` : `Opened “${ex.title}”`);
}

export function Gallery({ onClose }: { onClose: () => void }) {
  const [cat, setCat] = useState(GRAPH_EXAMPLES[0].id);
  const dark = useResolvedTheme() === 'dark';
  const category = GRAPH_EXAMPLES.find((c) => c.id === cat)!;
  const thumbs = useMemo(() => category.items.map((ex) => thumb(ex, dark)), [category, dark]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog gallery" role="dialog" aria-label="Graph examples" onClick={(e) => e.stopPropagation()}>
        <div className="gallery-head">
          <div>
            <h2>What can I plot?</h2>
            <p className="small muted">Pick an example to see how it’s written — then edit it.</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="gallery-body">
          <nav className="gallery-cats" aria-label="Categories">
            {GRAPH_EXAMPLES.map((c) => (
              <button key={c.id} className={`script-item${c.id === cat ? ' active' : ''}`} onClick={() => setCat(c.id)}>
                {c.title}
              </button>
            ))}
          </nav>
          <div className="gallery-main">
            <div className="gallery-intro">
              <p>{category.blurb}</p>
              <code>{category.syntax}</code>
            </div>
            <div className="gallery-grid">
              {category.items.map((ex, i) => (
                <article className="gallery-card" key={ex.title}>
                  {thumbs[i] && <img src={thumbs[i]} alt="" width={260} height={150} loading="lazy" />}
                  <div className="gallery-card-body">
                    <strong>{ex.title}</strong>
                    <span className="small muted">{ex.desc}</span>
                    <div className="gallery-exprs">
                      {ex.exprs.map((e, k) => (
                        <code key={k}>{typeof e === 'string' ? e : e.text}</code>
                      ))}
                    </div>
                    <div className="row">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          applyExample(ex, 'replace');
                          onClose();
                        }}
                      >
                        <Replace size={14} /> Open
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          applyExample(ex, 'add');
                          onClose();
                        }}
                      >
                        <Plus size={14} /> Add to graph
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
