/**
 * postMessage bridge for embedded instances (/embed/<mode>).
 *
 * Host → Calci messages ({ source: 'calci-host', ... }):
 *   { type: 'evaluate', id, expr }            → reply { type: 'result', id, ok, text, tex, error }
 *   { type: 'setExpressions', expressions }   (graph) replace the expression list
 *   { type: 'addExpression', expression }     (graph) append an expression
 *   { type: 'setViewport', xmin, xmax, ymin?, ymax? } (graph)
 *   { type: 'setTheme', theme, accent? }
 *   { type: 'getState', id }                  → reply { type: 'state', id, state }
 *
 * Calci → host events ({ source: 'calci', type, ... }): ready, result, graphChange, resize.
 */
import { Calculator } from '../core/index';
import { useStore, nextColor, uid, type GraphExpr } from '../app/store';

let parentOrigin = '*';

export function emitEmbed(type: string, payload: Record<string, unknown> = {}) {
  if (typeof window === 'undefined' || window.parent === window) return;
  try {
    window.parent.postMessage({ source: 'calci', type, ...payload }, parentOrigin);
  } catch {
    /* ignore */
  }
}

/** Expressions passed in the URL: ?expr=y%3Dx%5E2&expr=... or ?expressions=["…","…"] */
export function expressionsFromQuery(params: URLSearchParams): string[] | null {
  const list = params.getAll('expr');
  if (list.length) return list;
  const json = params.get('expressions');
  if (json) {
    try {
      const v = JSON.parse(json);
      if (Array.isArray(v)) return v.map(String).slice(0, 100);
    } catch {
      /* ignore */
    }
  }
  return null;
}

function toExprs(texts: string[]): GraphExpr[] {
  const out: GraphExpr[] = [];
  for (const t of texts.slice(0, 100)) out.push({ id: uid(), text: String(t).slice(0, 2000), color: nextColor(out) });
  return out;
}

export function initEmbedBridge(): () => void {
  const params = new URLSearchParams(location.search);
  const exprs = expressionsFromQuery(params);
  const st = useStore.getState();
  if (exprs) st.setGraph({ exprs: toExprs(exprs) });
  const xmin = Number(params.get('xmin'));
  const xmax = Number(params.get('xmax'));
  if (Number.isFinite(xmin) && Number.isFinite(xmax) && xmax > xmin && params.has('xmin')) {
    const ymin = Number(params.get('ymin'));
    const ymax = Number(params.get('ymax'));
    const hasY = params.has('ymin') && params.has('ymax') && ymax > ymin;
    st.setView({ cx: (xmin + xmax) / 2, cy: hasY ? (ymin + ymax) / 2 : 0, xspan: xmax - xmin, yspan: hasY ? ymax - ymin : null });
  }
  if (params.get('angle') === 'deg' || params.get('angle') === 'rad') st.setCalc({ angle: params.get('angle') as 'deg' | 'rad' });

  const calc = new Calculator({ safe: true });
  const onMessage = (e: MessageEvent) => {
    const d = e.data;
    if (!d || typeof d !== 'object' || d.source !== 'calci-host') return;
    // Only the page that embeds us may control the widget (not sibling frames).
    if (e.source !== window.parent) return;
    // Lock replies to the host's origin on first contact.
    if (parentOrigin === '*' && e.origin && e.origin !== 'null') parentOrigin = e.origin;
    else if (parentOrigin !== '*' && e.origin !== parentOrigin) return;
    const s = useStore.getState();
    switch (d.type) {
      case 'evaluate': {
        const r = calc.evaluate(String(d.expr ?? '').slice(0, 5000));
        emitEmbed('result', { id: d.id, ok: r.ok, text: r.text, tex: r.tex, error: r.error });
        break;
      }
      case 'setExpressions':
        if (Array.isArray(d.expressions)) s.setGraph({ exprs: toExprs(d.expressions) });
        break;
      case 'addExpression':
        if (typeof d.expression === 'string') s.addExpr(d.expression.slice(0, 2000));
        break;
      case 'setViewport':
        if ([d.xmin, d.xmax].every(Number.isFinite) && d.xmax > d.xmin) {
          const hasY = Number.isFinite(d.ymin) && Number.isFinite(d.ymax) && d.ymax > d.ymin;
          s.setView({ cx: (d.xmin + d.xmax) / 2, cy: hasY ? (d.ymin + d.ymax) / 2 : s.graph.view.cy, xspan: d.xmax - d.xmin, yspan: hasY ? d.ymax - d.ymin : null });
        }
        break;
      case 'setTheme':
        if (d.theme === 'dark' || d.theme === 'light') document.documentElement.dataset.theme = d.theme;
        if (typeof d.accent === 'string' && /^[a-z]+$/.test(d.accent)) document.documentElement.dataset.accent = d.accent;
        break;
      case 'getState':
        emitEmbed('state', { id: d.id, state: { expressions: s.graph.exprs.map((x) => x.text), view: s.graph.view, history: s.history.slice(0, 50) } });
        break;
    }
  };
  window.addEventListener('message', onMessage);
  const unsub = useStore.subscribe((cur, prev) => {
    if (cur.graph.exprs !== prev.graph.exprs) emitEmbed('graphChange', { expressions: cur.graph.exprs.map((x) => x.text) });
  });
  const ro = new ResizeObserver(() => emitEmbed('resize', { height: document.documentElement.scrollHeight }));
  ro.observe(document.body);
  emitEmbed('ready', { version: '1.1.0' });
  return () => {
    window.removeEventListener('message', onMessage);
    unsub();
    ro.disconnect();
  };
}
