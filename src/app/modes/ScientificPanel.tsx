import { useState } from 'react';
import { Copy, History, Trash2, X, Search } from 'lucide-react';
import { getCalculator } from '../engine';
import { useStore, type HistoryEntry } from '../store';
import { Tex, copyText, Segmented } from '../ui';
import { FN_DOCS, CONSTANTS, sigParts } from '../fnDocs';

export function SigHelp({ sig, arg }: { sig: string; arg: number }) {
  const { name, args } = sigParts(sig);
  return (
    <code>
      {name}(
      {args.map((a, i) => (
        <span key={i}>
          {i > 0 && ', '}
          <span className={i === arg ? 'sig-active' : ''}>{a}</span>
        </span>
      ))}
      )
    </code>
  );
}

export function SidePanel({ onInsert, onLoad }: { onInsert: (t: string) => void; onLoad: (h: HistoryEntry) => void }) {
  const [tab, setTab] = useState<'history' | 'vars' | 'consts' | 'fns'>('history');
  const history = useStore((s) => s.history);
  const removeHistory = useStore((s) => s.removeHistory);
  const clearHistory = useStore((s) => s.clearHistory);
  const [q, setQ] = useState('');
  const calc = getCalculator();
  const [, force] = useState(0);
  const vars = calc.variables().filter((v) => !(v.name === 'M' && v.text === '0'));
  const fns = FN_DOCS.filter((d) => !q || `${d.name} ${d.desc} ${d.cat}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="side-panel">
      <div style={{ padding: '10px 10px 0' }}>
        <Segmented
          value={tab}
          onChange={setTab}
          size="sm"
          options={[
            { value: 'history', label: 'History' },
            { value: 'vars', label: 'Variables' },
            { value: 'consts', label: 'Constants' },
            { value: 'fns', label: 'Functions' },
          ]}
        />
      </div>
      <div className="side-list">
        {tab === 'history' &&
          (history.length === 0 ? (
            <div className="empty">
              <History size={22} />
              Your calculations will appear here.
            </div>
          ) : (
            <>
              {history.slice(0, 200).map((h) => (
                <div key={h.id} className="hist-item">
                  <button className="hist-input" onClick={() => onLoad(h)} title="Edit this expression">
                    {h.inputTex ? <Tex tex={h.inputTex} /> : h.input}
                  </button>
                  <div className="row nowrap">
                    <button className="hist-result num" onClick={() => onInsert(h.result.replace(/,/g, '').replace(/E/, 'e'))} title="Insert result">
                      = {h.tex ? <Tex tex={h.tex} /> : h.result}
                    </button>
                    <div className="spacer" />
                    <button className="icon-btn sm hist-act" onClick={() => copyText(h.result)} aria-label="Copy">
                      <Copy size={14} />
                    </button>
                    <button className="icon-btn sm hist-act" onClick={() => removeHistory(h.id)} aria-label="Delete">
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
              <button className="btn btn-ghost btn-sm" style={{ margin: 8 }} onClick={clearHistory}>
                <Trash2 size={14} /> Clear history
              </button>
            </>
          ))}
        {tab === 'vars' && (
          <>
            {vars.length === 0 ? (
              <div className="empty">
                No variables yet. Assign with <code>a = 5</code> or define <code>f(x) = x^2</code>.
              </div>
            ) : (
              vars.map((v) => (
                <div key={v.name} className="var-item">
                  <button className="var-name" onClick={() => onInsert(v.name)}>
                    <code>{v.isFunction ? v.text : v.name}</code>
                  </button>
                  {!v.isFunction && <span className="num var-val">{v.tex ? <Tex tex={v.tex} /> : v.text}</span>}
                  <div className="spacer" />
                  <button
                    className="icon-btn sm"
                    onClick={() => {
                      calc.deleteVariable(v.name);
                      force((n) => n + 1);
                    }}
                    aria-label={`Delete ${v.name}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))
            )}
            {calc.libraryFunctionNames.length > 0 && (
              <div className="small muted" style={{ padding: '8px 12px' }}>
                Library: {calc.libraryFunctionNames.join(', ')} — edit in Code & Library.
              </div>
            )}
          </>
        )}
        {tab === 'consts' &&
          CONSTANTS.map((c) => (
            <button key={c.insert} className="const-item" onClick={() => onInsert(c.insert)} title={`Insert ${c.insert}`}>
              <span className="const-sym">{c.sym}</span>
              <span className="stack-sm" style={{ gap: 0, minWidth: 0 }}>
                <span>{c.name}</span>
                <span className="small muted num">{c.value}</span>
              </span>
            </button>
          ))}
        {tab === 'fns' && (
          <>
            <div className="row nowrap" style={{ padding: '4px 10px 8px' }}>
              <Search size={15} className="muted" />
              <input className="input" style={{ height: 30 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search functions" aria-label="Search functions" />
            </div>
            {fns.map((d) => (
              <button key={d.name} className="const-item" onClick={() => onInsert(d.name === 'to' ? ' to ' : `${d.name}(`)}>
                <span className="stack-sm" style={{ gap: 0, minWidth: 0 }}>
                  <code>{d.sig}</code>
                  <span className="small muted">{d.desc}</span>
                </span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
