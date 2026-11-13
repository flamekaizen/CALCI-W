/**
 * calci-embed.js — drop-in widget loader (no dependencies, ~4 kB).
 *
 *   <script src="https://<your-calci-host>/sdk/calci-embed.js" defer></script>
 *   <calci-calculator mode="graph" theme="light" expressions='["y=x^2","y=sin(x)"]' height="480"></calci-calculator>
 *
 *   const el = document.querySelector('calci-calculator');
 *   el.addEventListener('calci-result', (e) => console.log(e.detail));
 *   await el.evaluate('2^10');                 // { ok: true, text: '1024', ... }
 *   el.setExpressions(['y = cos(x)']);
 *
 *   // or imperatively:
 *   Calci.embed('#target', { mode: 'scientific', theme: 'dark' });
 *   await Calci.api.evaluate('sqrt(2)');
 */

const SCRIPT_ORIGIN = (() => {
  try {
    const s = document.currentScript as HTMLScriptElement | null;
    if (s?.src) return new URL(s.src).origin;
  } catch {
    /* ignore */
  }
  return location.origin;
})();

const MODES = ['scientific', 'graph', '3d', 'programmer', 'matrix', 'solver', 'calculus', 'stats', 'finance', 'units'];

interface EmbedOptions {
  mode?: string;
  theme?: 'light' | 'dark';
  accent?: string;
  expressions?: string[];
  height?: number | string;
  angle?: 'deg' | 'rad';
  xmin?: number;
  xmax?: number;
  ymin?: number;
  ymax?: number;
  hideExpressions?: boolean;
  origin?: string;
}

function buildSrc(o: EmbedOptions): string {
  const mode = o.mode && MODES.includes(o.mode) ? o.mode : 'scientific';
  const q = new URLSearchParams();
  if (o.theme) q.set('theme', o.theme);
  if (o.accent) q.set('accent', o.accent);
  if (o.angle) q.set('angle', o.angle);
  for (const k of ['xmin', 'xmax', 'ymin', 'ymax'] as const) if (typeof o[k] === 'number') q.set(k, String(o[k]));
  o.expressions?.forEach((e) => q.append('expr', e));
  if (o.hideExpressions) q.set('expressions', 'hidden');
  return `${(o.origin ?? SCRIPT_ORIGIN).replace(/\/+$/, '')}/embed/${mode}${q.toString() ? `?${q}` : ''}`;
}

let seq = 0;

class CalciCalculator extends HTMLElement {
  static observedAttributes = ['mode', 'theme', 'accent', 'expressions', 'height', 'angle', 'origin', 'xmin', 'xmax', 'ymin', 'ymax', 'hide-expressions'];
  private iframe: HTMLIFrameElement | null = null;
  private pending = new Map<number, (v: any) => void>();
  private ready: Promise<void>;
  private resolveReady!: () => void;
  private onMessage = (e: MessageEvent) => {
    if (!this.iframe || e.source !== this.iframe.contentWindow) return;
    const d = e.data;
    if (!d || d.source !== 'calci') return;
    if (d.type === 'ready') this.resolveReady();
    if (d.id && this.pending.has(d.id)) {
      this.pending.get(d.id)!(d);
      this.pending.delete(d.id);
      return;
    }
    this.dispatchEvent(new CustomEvent(`calci-${d.type}`, { detail: d, bubbles: true }));
  };

  constructor() {
    super();
    this.ready = new Promise((r) => (this.resolveReady = r));
  }

  private options(): EmbedOptions {
    let expressions: string[] | undefined;
    const raw = this.getAttribute('expressions');
    if (raw) {
      try {
        const v = JSON.parse(raw);
        expressions = Array.isArray(v) ? v.map(String) : [String(v)];
      } catch {
        expressions = raw.split(';').map((s) => s.trim()).filter(Boolean);
      }
    }
    const n = (k: string) => (this.hasAttribute(k) ? Number(this.getAttribute(k)) : undefined);
    return {
      mode: this.getAttribute('mode') ?? 'scientific',
      theme: (this.getAttribute('theme') as 'light' | 'dark') ?? undefined,
      accent: this.getAttribute('accent') ?? undefined,
      angle: (this.getAttribute('angle') as 'deg' | 'rad') ?? undefined,
      origin: this.getAttribute('origin') ?? undefined,
      xmin: n('xmin'),
      xmax: n('xmax'),
      ymin: n('ymin'),
      ymax: n('ymax'),
      hideExpressions: this.hasAttribute('hide-expressions'),
      expressions,
    };
  }

  connectedCallback() {
    if (!this.style.display) this.style.display = 'block';
    this.render();
    window.addEventListener('message', this.onMessage);
  }
  disconnectedCallback() {
    window.removeEventListener('message', this.onMessage);
  }
  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  private render() {
    const src = buildSrc(this.options());
    const h = this.getAttribute('height') ?? '520';
    if (!this.iframe) {
      this.iframe = document.createElement('iframe');
      this.iframe.title = 'Calci calculator';
      this.iframe.loading = 'lazy';
      this.iframe.allow = 'clipboard-write';
      this.iframe.style.cssText = 'width:100%;border:0;border-radius:12px;display:block;background:transparent';
      this.appendChild(this.iframe);
    }
    this.iframe.style.height = /^\d+$/.test(h) ? `${h}px` : h;
    if (this.iframe.src !== src) {
      this.ready = new Promise((r) => (this.resolveReady = r));
      this.iframe.src = src;
    }
  }

  private send(msg: Record<string, unknown>, expectReply = false): Promise<any> {
    return this.ready.then(
      () =>
        new Promise((resolve) => {
          const id = expectReply ? ++seq : undefined;
          if (id) this.pending.set(id, resolve);
          this.iframe?.contentWindow?.postMessage({ source: 'calci-host', id, ...msg }, '*');
          if (!id) resolve(undefined);
        }),
    );
  }

  /** Evaluate an expression inside the widget's engine. */
  evaluate(expr: string) {
    return this.send({ type: 'evaluate', expr }, true);
  }
  setExpressions(expressions: string[]) {
    return this.send({ type: 'setExpressions', expressions });
  }
  addExpression(expression: string) {
    return this.send({ type: 'addExpression', expression });
  }
  setViewport(v: { xmin: number; xmax: number; ymin?: number; ymax?: number }) {
    return this.send({ type: 'setViewport', ...v });
  }
  setTheme(theme: 'light' | 'dark', accent?: string) {
    return this.send({ type: 'setTheme', theme, accent });
  }
  getState() {
    return this.send({ type: 'getState' }, true);
  }
}

if (!customElements.get('calci-calculator')) customElements.define('calci-calculator', CalciCalculator);

const api = {
  async call(endpoint: string, body: Record<string, unknown> = {}) {
    const r = await fetch(`${SCRIPT_ORIGIN}/api/v1/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error ?? `Calci API error ${r.status}`);
    return data;
  },
  evaluate(expr: string, options: Record<string, unknown> = {}) {
    return this.call('evaluate', { expr, ...options });
  },
  plotUrl(expressions: string[], opts: Record<string, string | number> = {}) {
    const q = new URLSearchParams();
    expressions.forEach((e) => q.append('expr', e));
    Object.entries(opts).forEach(([k, v]) => q.set(k, String(v)));
    return `${SCRIPT_ORIGIN}/api/v1/plot?${q}`;
  },
};

function embed(target: string | Element, opts: EmbedOptions = {}): CalciCalculator {
  const host = typeof target === 'string' ? document.querySelector(target) : target;
  if (!host) throw new Error(`Calci.embed: target ${String(target)} not found`);
  const el = document.createElement('calci-calculator') as CalciCalculator;
  if (opts.mode) el.setAttribute('mode', opts.mode);
  if (opts.theme) el.setAttribute('theme', opts.theme);
  if (opts.accent) el.setAttribute('accent', opts.accent);
  if (opts.angle) el.setAttribute('angle', opts.angle);
  if (opts.height !== undefined) el.setAttribute('height', String(opts.height));
  if (opts.expressions) el.setAttribute('expressions', JSON.stringify(opts.expressions));
  if (opts.hideExpressions) el.setAttribute('hide-expressions', '');
  for (const k of ['xmin', 'xmax', 'ymin', 'ymax'] as const) if (typeof opts[k] === 'number') el.setAttribute(k, String(opts[k]));
  if (opts.origin) el.setAttribute('origin', opts.origin);
  host.appendChild(el);
  return el;
}

(window as any).Calci = { embed, api, version: '1.1.0', origin: SCRIPT_ORIGIN };
export { embed, api, CalciCalculator };
