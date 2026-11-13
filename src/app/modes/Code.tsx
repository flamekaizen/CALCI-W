import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, Plus, Trash2, BookOpen, FileCode, Copy } from 'lucide-react';
import { useStore, uid, type Script } from '../store';
import { getCalculator, libraryErrors } from '../engine';
import { Editor } from '../components/Editor';
import { Plot, type Series } from '../components/Plot';
import { Segmented, Tex, copyText, toast } from '../ui';
import { CURVE_COLORS_LIGHT } from '../../core/graph/palette';
import '../../styles/modes/tools.css';

type Out =
  | { kind: 'text'; text: string; level?: 'err' | 'info' }
  | { kind: 'table'; rows: Record<string, string>[] }
  | { kind: 'plot'; series: { pts: [number, number][]; label?: string; points?: boolean }[] };

const RUN_LIMIT_MS = 20000;

export default function Code() {
  const scripts = useStore((s) => s.scripts);
  const set = useStore((s) => s.set);
  const [sel, setSel] = useState<string>('library');
  const script = scripts.find((s) => s.id === sel);

  const update = (patch: Partial<Script>) => set({ scripts: scripts.map((s) => (s.id === sel ? { ...s, ...patch } : s)) });
  const create = (lang: Script['lang']) => {
    const s: Script = {
      id: uid(),
      name: lang === 'python' ? 'Untitled.py' : 'Untitled.js',
      lang,
      code: lang === 'python' ? 'print("Hello from Python")\n' : '// print(), table() and plot() are available. `math` is the Calci engine.\nprint(math.evaluate("2^10"))\n',
    };
    set({ scripts: [...scripts, s] });
    setSel(s.id);
  };

  return (
    <div className="code-layout">
      <aside className="stack-sm">
        <div className="script-list">
          <button className={`script-item${sel === 'library' ? ' active' : ''}`} onClick={() => setSel('library')}>
            <BookOpen size={15} /> Function library
          </button>
        </div>
        <div className="section-title" style={{ marginTop: 10 }}>
          Programs
        </div>
        <div className="script-list">
          {scripts.map((s) => (
            <button key={s.id} className={`script-item${sel === s.id ? ' active' : ''}`} onClick={() => setSel(s.id)}>
              <FileCode size={15} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
              <span className="badge" style={{ marginLeft: 'auto', height: 18, fontSize: 10 }}>
                {s.lang === 'python' ? 'PY' : 'JS'}
              </span>
            </button>
          ))}
        </div>
        <div className="row">
          <button className="btn btn-ghost btn-sm" onClick={() => create('js')}>
            <Plus size={14} /> JavaScript
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => create('python')}>
            <Plus size={14} /> Python
          </button>
        </div>
      </aside>
      <main style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        {sel === 'library' || !script ? (
          <Library />
        ) : (
          <ScriptEditor
            key={script.id}
            script={script}
            onChange={update}
            onDelete={() => {
              set({ scripts: scripts.filter((s) => s.id !== script.id) });
              setSel('library');
            }}
          />
        )}
      </main>
    </div>
  );
}

function ScriptEditor({ script, onChange, onDelete }: { script: Script; onChange: (p: Partial<Script>) => void; onDelete: () => void }) {
  const library = useStore((s) => s.library);
  const [out, setOut] = useState<Out[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const workerRef = useRef<Worker | null>(null);
  const timerRef = useRef<number>(0);

  const stop = (msg = 'Stopped') => {
    workerRef.current?.terminate();
    workerRef.current = null;
    window.clearTimeout(timerRef.current);
    setRunning(false);
    setStatus(msg);
  };
  useEffect(() => () => stop(), []);

  const run = () => {
    stop('');
    setOut([]);
    setStatus(script.lang === 'python' ? 'Starting…' : 'Running…');
    setRunning(true);
    const w = new Worker(new URL('../../workers/script.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    const t0 = performance.now();
    const arm = () => {
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        stop(`Stopped: exceeded ${RUN_LIMIT_MS / 1000}s time limit`);
        setOut((o) => [...o, { kind: 'text', level: 'err', text: 'Script took too long and was stopped (possible infinite loop).' }]);
      }, RUN_LIMIT_MS);
    };
    if (script.lang !== 'python') arm();
    w.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'print') setOut((o) => [...o, { kind: 'text' as const, text: String(d.text), level: d.level }].slice(-2000));
      else if (d.type === 'table') setOut((o) => [...o, { kind: 'table', rows: d.rows }]);
      else if (d.type === 'plot') setOut((o) => [...o, { kind: 'plot', series: d.series }]);
      else if (d.type === 'error') setOut((o) => [...o, { kind: 'text', level: 'err', text: d.message }]);
      else if (d.type === 'status') {
        setStatus(d.text);
        if (d.text === 'Python ready') arm();
      } else if (d.type === 'done') {
        const ms = performance.now() - t0;
        stop(d.failed ? 'Finished with an error' : `Finished in ${ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(2)} s`}`);
      }
    };
    w.onerror = (e) => {
      setOut((o) => [...o, { kind: 'text', level: 'err', text: e.message || 'Worker error' }]);
      stop('Failed');
    };
    w.postMessage({ type: 'run', lang: script.lang, code: script.code, library });
  };

  return (
    <>
      <div className="row nowrap">
        <input className="input" style={{ maxWidth: 280 }} value={script.name} onChange={(e) => onChange({ name: e.target.value })} aria-label="Script name" />
        <Segmented
          size="sm"
          value={script.lang}
          onChange={(lang) => onChange({ lang })}
          options={[
            { value: 'js', label: 'JavaScript' },
            { value: 'python', label: 'Python' },
          ]}
        />
        <div className="spacer" />
        <button className="icon-btn" onClick={() => copyText(script.code)} aria-label="Copy code" title="Copy code">
          <Copy size={16} />
        </button>
        <button className="icon-btn" onClick={onDelete} aria-label="Delete script" title="Delete script">
          <Trash2 size={16} />
        </button>
        {running ? (
          <button className="btn btn-secondary" onClick={() => stop()}>
            <Square size={14} /> Stop
          </button>
        ) : (
          <button className="btn btn-primary" onClick={run} title="Run (Ctrl+Enter)">
            <Play size={14} /> Run
          </button>
        )}
      </div>
      <Editor value={script.code} onChange={(code) => onChange({ code })} lang={script.lang} onRun={run} />
      <div className="row small muted">
        <span>{status}</span>
        <div className="spacer" />
        <span>
          <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to run · scripts run in a sandboxed worker with a {RUN_LIMIT_MS / 1000}s limit
        </span>
      </div>
      <div className="console" role="log" aria-label="Output">
        {out.length === 0 && <div className="console-line info">Output appears here.</div>}
        {out.map((o, i) => {
          if (o.kind === 'text')
            return (
              <div key={i} className={`console-line${o.level ? ` ${o.level}` : ''}`}>
                {o.text}
              </div>
            );
          if (o.kind === 'table') {
            const cols = [...new Set(o.rows.flatMap((r) => Object.keys(r)))];
            return (
              <table key={i}>
                <thead>
                  <tr>
                    {cols.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {o.rows.map((r, k) => (
                    <tr key={k}>
                      {cols.map((c) => (
                        <td key={c}>{r[c]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          }
          return <ConsolePlot key={i} series={o.series} />;
        })}
      </div>
    </>
  );
}

function ConsolePlot({ series }: { series: { pts: [number, number][]; label?: string; points?: boolean }[] }) {
  const all = series.flatMap((s) => s.pts);
  const xs = all.map((p) => p[0]).filter(Number.isFinite);
  const x: [number, number] = xs.length ? [Math.min(...xs), Math.max(...xs)] : [-1, 1];
  if (x[0] === x[1]) x[1] = x[0] + 1;
  const ss: Series[] = series.map((s, i) =>
    s.points
      ? { type: 'points', pts: s.pts, color: CURVE_COLORS_LIGHT[i % 8], r: 3.5, label: s.label }
      : { type: 'line', pts: s.pts.filter((p) => Number.isFinite(p[1])), color: CURVE_COLORS_LIGHT[i % 8], label: s.label },
  );
  return (
    <div style={{ margin: '8px 0', background: 'var(--surface)', borderRadius: 10, padding: 6 }}>
      <Plot x={x} series={ss} height={220} />
    </div>
  );
}

function Library() {
  const library = useStore((s) => s.library);
  const set = useStore((s) => s.set);
  const [draft, setDraft] = useState(library);
  const [test, setTest] = useState('hyp(3, 4)');
  useEffect(() => {
    const t = window.setTimeout(() => draft !== library && set({ library: draft }), 400);
    return () => window.clearTimeout(t);
  }, [draft, library, set]);
  const errors = useMemo(() => {
    void library;
    return libraryErrors();
  }, [library]);
  const names = useMemo(() => {
    void library;
    return getCalculator().libraryFunctionNames;
  }, [library]);
  const result = useMemo(() => {
    void library;
    return test.trim() ? getCalculator().preview(test) : null;
  }, [test, library]);
  return (
    <>
      <div className="row">
        <h2 style={{ fontSize: 16 }}>Function library</h2>
        <div className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={() => (copyText(draft), toast('Library copied'))}>
          <Copy size={14} /> Copy
        </button>
      </div>
      <p className="small muted">
        Define your own functions and constants once — they work in the Scientific calculator, Graphing, 3D, Matrix and scripts. One definition per line, e.g.{' '}
        <code>area(r) = pi r^2</code> or <code>k = 8.99e9</code>.
      </p>
      <Editor value={draft} onChange={setDraft} lang="plain" ariaLabel="Function library" />
      {errors.length > 0 && (
        <div className="stack-sm">
          {errors.map((e) => (
            <div key={e.line} className="error-text">
              Line {e.line}: {e.error}
            </div>
          ))}
        </div>
      )}
      <div className="card card-pad stack-sm">
        <div className="row small muted">
          Defined: {names.length ? names.map((n) => <code key={n}>{n}</code>) : 'nothing yet'}
        </div>
        <div className="row nowrap">
          <input className="input mono" value={test} onChange={(e) => setTest(e.target.value)} placeholder="Try it, e.g. hyp(3, 4)" aria-label="Test expression" />
        </div>
        {result && (
          <div className="result-box accent">
            <Tex tex={result.tex} />
          </div>
        )}
      </div>
    </>
  );
}
