/**
 * Calci JavaScript SDK.
 *
 *   import { evaluate, Calculator, graph, CalciClient } from 'https://<your-calci-host>/sdk/calci.js';
 *
 *   evaluate('integral(x^2, x, 0, 3)').text   // "9"
 *   graph.renderSvg(['y = sin(x)'])           // SVG string
 *   await new CalciClient().evaluate('2^64')  // via the REST API
 */
export * from '../core/index';

export interface ClientOptions {
  /** Base URL of a Calci deployment. Defaults to the origin this SDK was loaded from. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

/** Minimal REST client for the Calci API (useful when you don't want the engine in your bundle). */
export class CalciClient {
  private base: string;
  private f: typeof fetch;
  constructor(opts: ClientOptions = {}) {
    const fromModule = (() => {
      try {
        return new URL(import.meta.url).origin;
      } catch {
        return '';
      }
    })();
    this.base = (opts.baseUrl ?? fromModule).replace(/\/+$/, '');
    this.f = opts.fetch ?? fetch.bind(globalThis);
  }
  async call<T = any>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
    const r = await this.f(`${this.base}/api/v1/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error ?? `Calci API error ${r.status}`);
    return data as T;
  }
  evaluate(expr: string, options: Record<string, unknown> = {}) {
    return this.call('evaluate', { expr, ...options });
  }
  derivative(expr: string, variable = 'x', order = 1) {
    return this.call('derivative', { expr, variable, order });
  }
  integral(expr: string, a: number | string, b: number | string, variable = 'x') {
    return this.call('integral', { expr, a, b, variable });
  }
  solve(params: Record<string, unknown>) {
    return this.call('solve', params);
  }
  stats(data: number[], y?: number[], model?: string) {
    return this.call('stats', { data, y, model });
  }
  convert(value: number, from: string, to: string) {
    return this.call('convert', { value, from, to });
  }
  plotUrl(expressions: string[], opts: Record<string, string | number> = {}) {
    const q = new URLSearchParams();
    expressions.forEach((e) => q.append('expr', e));
    Object.entries(opts).forEach(([k, v]) => q.set(k, String(v)));
    return `${this.base}/api/v1/plot?${q}`;
  }
}
