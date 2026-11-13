import { useMemo, useState } from 'react';
import { Plug, Code2, Boxes, Image as ImageIcon, Send, ExternalLink } from 'lucide-react';
import { openapi } from '../../api/openapi';
import { Segmented, CodeBlock, Tabs } from '../ui';
import { PUBLIC_ORIGIN, API_BASE, isNative } from '../platform';
import '../../styles/modes/tools.css';

/** Host shown in copy-paste snippets. */
const ORIGIN = PUBLIC_ORIGIN;
/** Host used for live previews (local dev server on the web, the public site in native shells). */
const PREVIEW = isNative || typeof location === 'undefined' ? PUBLIC_ORIGIN : location.origin;

type Section = 'embed' | 'api' | 'sdk' | 'messages';

export default function Developers() {
  const [section, setSection] = useState<Section>('embed');
  return (
    <div className="page">
      <section className="dev-hero">
        <h2>Put Calci inside your product</h2>
        <p className="muted">Every calculator here is available as an embeddable widget, a REST API and a JavaScript SDK — free to integrate, no keys required.</p>
        <div className="dev-cards">
          <button className="dev-card" onClick={() => setSection('embed')}>
            <Boxes size={20} />
            <strong>Embed widgets</strong>
            <span>Drop any mode into a page with one tag</span>
          </button>
          <button className="dev-card" onClick={() => setSection('api')}>
            <Plug size={20} />
            <strong>REST API</strong>
            <span>JSON endpoints for maths, stats and finance</span>
          </button>
          <button className="dev-card" onClick={() => setSection('sdk')}>
            <Code2 size={20} />
            <strong>JavaScript SDK</strong>
            <span>Run the full engine in browsers and Node</span>
          </button>
          <button className="dev-card" onClick={() => setSection('messages')}>
            <ImageIcon size={20} />
            <strong>Graph images & events</strong>
            <span>SVG plots by URL, postMessage control</span>
          </button>
        </div>
      </section>
      <Tabs
        value={section}
        onChange={setSection}
        tabs={[
          { id: 'embed', label: 'Embed builder' },
          { id: 'api', label: 'REST API' },
          { id: 'sdk', label: 'SDK' },
          { id: 'messages', label: 'Images & events' },
        ]}
      />
      {section === 'embed' && <EmbedBuilder />}
      {section === 'api' && <ApiExplorer />}
      {section === 'sdk' && <SdkDocs />}
      {section === 'messages' && <EventsDocs />}
    </div>
  );
}

const EMBED_MODES = [
  { value: 'graph', label: 'Graphing' },
  { value: 'scientific', label: 'Scientific' },
  { value: '3d', label: '3D' },
  { value: 'programmer', label: 'Programmer' },
  { value: 'stats', label: 'Statistics' },
  { value: 'units', label: 'Converter' },
  { value: 'finance', label: 'Finance' },
];

function EmbedBuilder() {
  const [mode, setMode] = useState('graph');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [accent, setAccent] = useState('indigo');
  const [height, setHeight] = useState(480);
  const [exprs, setExprs] = useState('y = sin(x)\ny = x^2/4 - 2');
  const [hideList, setHideList] = useState(false);
  const list = exprs.split('\n').map((s) => s.trim()).filter(Boolean);
  const q = new URLSearchParams({ theme, accent });
  if (mode === 'graph') list.forEach((e) => q.append('expr', e));
  if (mode === 'graph' && hideList) q.set('expressions', 'hidden');
  const src = `${ORIGIN}/embed/${mode}?${q}`;
  const previewSrc = `${PREVIEW}/embed/${mode}?${q}`;
  const iframe = `<iframe src="${src}"\n  width="100%" height="${height}" style="border:0;border-radius:12px"\n  loading="lazy" title="Calci ${mode}" allow="clipboard-write"></iframe>`;
  const wc = `<script src="${ORIGIN}/sdk/calci-embed.js" defer></script>\n\n<calci-calculator\n  mode="${mode}" theme="${theme}" accent="${accent}" height="${height}"${mode === 'graph' && list.length ? `\n  expressions='${JSON.stringify(list)}'` : ''}${hideList && mode === 'graph' ? '\n  hide-expressions' : ''}>\n</calci-calculator>`;
  const js = `<div id="calc"></div>\n<script src="${ORIGIN}/sdk/calci-embed.js"></script>\n<script>\n  const calc = Calci.embed('#calc', {\n    mode: '${mode}', theme: '${theme}', height: ${height}${mode === 'graph' ? `,\n    expressions: ${JSON.stringify(list)}` : ''}\n  });\n  calc.addEventListener('calci-result', (e) => console.log(e.detail));\n</script>`;
  const [snippet, setSnippet] = useState<'wc' | 'iframe' | 'js'>('wc');
  return (
    <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 0.85fr) minmax(0, 1.15fr)', alignItems: 'start' }}>
      <section className="card card-pad stack">
        <div className="field">
          <label>Mode</label>
          <select className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
            {EMBED_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <Segmented
            size="sm"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
          <select className="select" style={{ width: 130, height: 32 }} value={accent} onChange={(e) => setAccent(e.target.value)} aria-label="Accent">
            {['indigo', 'teal', 'sky', 'emerald', 'amber', 'rose'].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </div>
        <label className="field">
          <span className="label">Height: {height}px</span>
          <input type="range" min={320} max={900} step={20} value={height} onChange={(e) => setHeight(Number(e.target.value))} style={{ accentColor: 'var(--accent)' }} />
        </label>
        {mode === 'graph' && (
          <>
            <div className="field">
              <label>Expressions (one per line)</label>
              <textarea className="textarea mono" rows={4} value={exprs} onChange={(e) => setExprs(e.target.value)} />
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={hideList} onChange={(e) => setHideList(e.target.checked)} />
              Hide the expression list (graph only)
            </label>
          </>
        )}
        <Segmented
          size="sm"
          value={snippet}
          onChange={setSnippet}
          options={[
            { value: 'wc', label: 'Web component' },
            { value: 'iframe', label: 'iframe' },
            { value: 'js', label: 'JavaScript' },
          ]}
        />
        <CodeBlock code={snippet === 'wc' ? wc : snippet === 'iframe' ? iframe : js} />
      </section>
      <section className="card" style={{ overflow: 'hidden' }}>
        <div className="card-header">
          <h3>Live preview</h3>
          <div className="spacer" />
          <a className="btn btn-ghost btn-sm" href={previewSrc} target="_blank" rel="noreferrer">
            Open <ExternalLink size={13} />
          </a>
        </div>
        <iframe key={previewSrc + height} src={previewSrc} title="Embed preview" style={{ width: '100%', height, border: 0, display: 'block' }} />
      </section>
    </div>
  );
}

const SAMPLE_BODIES: Record<string, unknown> = {
  evaluate: { expr: 'sin(30) + sqrt(16)', angle: 'deg' },
  simplify: { expr: '2x + 3x - x^2/x' },
  derivative: { expr: 'x^2 sin(x)', variable: 'x', order: 1, at: 1 },
  integral: { expr: 'e^(-x^2)', a: '-Infinity', b: 'Infinity' },
  limit: { expr: 'sin(x)/x', at: 0 },
  taylor: { expr: 'cos(x)', at: 0, order: 6 },
  solve: { type: 'polynomial', coefficients: [1, -6, 11, -6] },
  stats: { data: [1, 2, 3, 4, 5], y: [2.1, 3.9, 6.2, 7.8, 10.1], model: 'linear' },
  distribution: { dist: 'normal', mu: 0, sigma: 1, a: -1.96, b: 1.96, p: 0.975 },
  convert: { value: 100, from: 'degC', to: 'degF' },
  programmer: { expr: 'FF AND 0F', base: 16, word: 32 },
  finance: { op: 'tvm', solve: 'pmt', n: 360, iy: 6, pv: 200000, fv: 0, py: 12, cy: 12 },
  units: {},
  functions: {},
};

function ApiExplorer() {
  const endpoints = Object.keys(openapi.paths).map((p) => p.slice(1)).filter((p) => p !== 'openapi' && p !== 'plot');
  const [ep, setEp] = useState('evaluate');
  const [bodyText, setBodyText] = useState(JSON.stringify(SAMPLE_BODIES.evaluate, null, 2));
  const [resp, setResp] = useState<{ status: number; text: string; ms: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const info = (openapi.paths as Record<string, any>)[`/${ep}`];
  const summary = info?.post?.summary ?? info?.get?.summary;
  const pick = (e: string) => {
    setEp(e);
    setBodyText(JSON.stringify(SAMPLE_BODIES[e] ?? {}, null, 2));
    setResp(null);
  };
  const send = async () => {
    setBusy(true);
    const t0 = performance.now();
    try {
      JSON.parse(bodyText || '{}');
      const r = await fetch(`${API_BASE}/api/v1/${ep}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bodyText || '{}' });
      const text = await r.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* not json */
      }
      setResp({ status: r.status, text: pretty, ms: performance.now() - t0 });
    } catch (e) {
      setResp({ status: 0, text: `Request failed: ${(e as Error).message}`, ms: performance.now() - t0 });
    } finally {
      setBusy(false);
    }
  };
  const curl = `curl -X POST ${ORIGIN}/api/v1/${ep} \\\n  -H "Content-Type: application/json" \\\n  -d '${bodyText.replace(/\s+/g, ' ').trim()}'`;
  return (
    <div className="grid-2" style={{ gridTemplateColumns: '220px minmax(0, 1fr)', alignItems: 'start' }}>
      <aside className="script-list card card-pad" style={{ padding: 6 }}>
        {endpoints.map((e) => (
          <button key={e} className={`script-item${ep === e ? ' active' : ''}`} onClick={() => pick(e)}>
            <code style={{ fontSize: 12 }}>/{e}</code>
          </button>
        ))}
        <a className="script-item" href={`${API_BASE}/api/v1/openapi`} target="_blank" rel="noreferrer">
          OpenAPI spec <ExternalLink size={12} />
        </a>
      </aside>
      <section className="stack">
        <div className="card card-pad stack-sm">
          <div className="row">
            <span className="badge accent">POST</span>
            <code>/api/v1/{ep}</code>
            <span className="small muted">{summary}</span>
          </div>
          <textarea className="textarea mono" rows={Math.min(14, bodyText.split('\n').length + 1)} value={bodyText} onChange={(e) => setBodyText(e.target.value)} aria-label="Request body" spellCheck={false} />
          <div className="row">
            <button className="btn btn-primary" onClick={send} disabled={busy}>
              <Send size={14} /> {busy ? 'Sending…' : 'Send request'}
            </button>
            {resp && (
              <span className={`badge ${resp.status >= 200 && resp.status < 300 ? 'success' : 'danger'}`}>
                {resp.status || 'error'} · {resp.ms.toFixed(0)} ms
              </span>
            )}
          </div>
          {resp && <CodeBlock code={resp.text} />}
          <div className="section-title" style={{ marginTop: 6 }}>
            cURL
          </div>
          <CodeBlock code={curl} />
        </div>
        <div className="card card-pad small muted stack-sm">
          <strong style={{ color: 'var(--text)' }}>Conventions</strong>
          <span>• Every endpoint accepts POST with a JSON body, or GET with the same fields as query parameters.</span>
          <span>• CORS is enabled for all origins. Responses are JSON; non-finite numbers are returned as the strings "Infinity" / "-Infinity", NaN as null.</span>
          <span>• Limits: expressions up to 2,000 characters, arrays up to 10,000 items, bodies up to 256 kB. Errors return {'{ "error": "…" }'} with a 4xx status.</span>
          <span>• Expressions use the same syntax as the calculator — see GET /api/v1/functions for the reference.</span>
        </div>
      </section>
    </div>
  );
}

function SdkDocs() {
  return (
    <div className="stack">
      <section className="card card-pad stack-sm">
        <div className="section-title">ES module (browsers, Deno, bundlers)</div>
        <CodeBlock
          code={`import { evaluate, Calculator, graph, solver, stats, CalciClient } from '${ORIGIN}/sdk/calci.js';

evaluate('integral(x^2, x, 0, 3)').text;          // "9"
evaluate('sin(30)', { angle: 'deg' }).exact?.text; // "1/2"

const calc = new Calculator({ angle: 'rad', digits: 10 });
calc.evaluate('f(x) = x^3 - 2x');
calc.evaluate('nsolve(f(x) - 5, x, 2)').text;      // "2.0945514815"

solver.polyRoots([1, 0, -2]);                      // [{re:-1.414…, im:0}, {re:1.414…, im:0}]
stats.regress([1,2,3], [2,4,6.1], 'linear').equation;
graph.renderSvg(['y = sin(x)', 'x^2 + y^2 = 9'], { width: 600, height: 400 });`}
        />
      </section>
      <section className="card card-pad stack-sm">
        <div className="section-title">Node.js / CommonJS (UMD build)</div>
        <CodeBlock code={`// download ${ORIGIN}/sdk/calci.umd.cjs into your project, then:\nconst { evaluate } = require('./calci.umd.cjs');\nconsole.log(evaluate('5 km to mi').text); // "3.10685596119 mi"`} />
      </section>
      <section className="card card-pad stack-sm">
        <div className="section-title">REST client (keeps your bundle tiny)</div>
        <CodeBlock code={`const client = new CalciClient({ baseUrl: '${ORIGIN}' });\nconst r = await client.evaluate('2^64');      // { ok: true, result: "18446744073709551616", ... }\nconst img = client.plotUrl(['y = x^2'], { theme: 'dark' }); // use in <img src>`} />
      </section>
    </div>
  );
}

function EventsDocs() {
  const [expr, setExpr] = useState('y = sin(x)\ny = cos(x)');
  const url = useMemo(() => {
    const q = new URLSearchParams();
    expr.split('\n').map((s) => s.trim()).filter(Boolean).forEach((e) => q.append('expr', e));
    q.set('width', '640');
    q.set('height', '360');
    return `${API_BASE}/api/v1/plot?${q}`;
  }, [expr]);
  return (
    <div className="stack">
      <section className="card card-pad stack-sm">
        <div className="section-title">Graphs as images</div>
        <p className="small muted">Any graph can be rendered to SVG by URL — perfect for emails, docs, chat bots and server-rendered pages. Responses are cached at the edge.</p>
        <textarea className="textarea mono" rows={3} value={expr} onChange={(e) => setExpr(e.target.value)} aria-label="Plot expressions" />
        <CodeBlock code={`<img src="${API_BASE ? '' : ORIGIN}${url}" alt="Graph" />`} />
        <img src={url} alt="Rendered graph" style={{ maxWidth: '100%', borderRadius: 12, border: '1px solid var(--border)', background: '#fff' }} />
      </section>
      <section className="card card-pad stack-sm">
        <div className="section-title">Controlling an embed with postMessage</div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Message to the widget</th>
                <th>Effect</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["{ source: 'calci-host', type: 'evaluate', id, expr }", "Replies { type: 'result', id, ok, text, tex }"],
                ["{ source: 'calci-host', type: 'setExpressions', expressions: [...] }", 'Replaces graph expressions'],
                ["{ source: 'calci-host', type: 'addExpression', expression }", 'Appends one expression'],
                ["{ source: 'calci-host', type: 'setViewport', xmin, xmax, ymin?, ymax? }", 'Moves the graph window'],
                ["{ source: 'calci-host', type: 'setTheme', theme, accent? }", 'Switches light / dark and accent'],
                ["{ source: 'calci-host', type: 'getState', id }", "Replies { type: 'state', id, state }"],
              ].map(([m, e]) => (
                <tr key={m}>
                  <td style={{ textAlign: 'left' }}>
                    <code style={{ fontSize: 12 }}>{m}</code>
                  </td>
                  <td style={{ textAlign: 'left' }}>{e}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          The widget emits <code>ready</code>, <code>result</code>, <code>graphChange</code> and <code>resize</code> events (with <code>source: 'calci'</code>). The web component re-dispatches them as DOM events named <code>calci-ready</code>, <code>calci-result</code>, … and
          exposes <code>evaluate()</code>, <code>setExpressions()</code>, <code>setViewport()</code>, <code>setTheme()</code> and <code>getState()</code> as promises.
        </p>
      </section>
    </div>
  );
}
