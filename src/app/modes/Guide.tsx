import { useMemo, useState } from 'react';
import { Search, ArrowRight, Copy } from 'lucide-react';
import { MODES, findMode } from '../modes';
import { navigate } from '../router';
import { FN_DOCS } from '../fnDocs';
import { GRAPH_EXAMPLES } from './graph/examples';
import { applyExample } from './graph/Gallery';
import { copyText, Tabs } from '../ui';
import '../../styles/modes/guide.css';

type Tab = 'start' | 'switch' | 'plot' | 'functions' | 'keys';

const MODE_FEATURES: Record<string, string[]> = {
  scientific: [
    'Textbook input: fractions stack, roots and powers look like the textbook (switch to one-line input any time)',
    'Every answer form at once: fraction, mixed number, recurring decimal, √ / π forms, D°M′S″, SI prefixes, prime factors, hex',
    'Integrals, derivatives, sums, limits and SOLVE on the keypad',
    'Verify equations: type 2+2 = 4 → true',
    'Letters you haven’t defined get value boxes (like CALC)',
    'Variables, Ans, memory, constants, history and your own functions',
  ],
  graph: [
    'Functions, implicit curves, polar, parametric, inequalities, points',
    "Sliders with animation, f'(x), integrals and sums inside graphs",
    'Roots, extrema and intersections; trace; zoom to fit',
    'Examples gallery, function palette, PNG / SVG export, share links',
  ],
  '3d': ['Surfaces z = f(x, y) and 3D space curves', 'Rotate, zoom, auto-rotate, mesh lines'],
  programmer: ['HEX / DEC / OCT / BIN with 8–128-bit words', 'AND OR XOR NOT NAND NOR, shifts and rotates', 'Bit toggles, IEEE-754 float view, characters'],
  matrix: ['Matrices up to 10×10: det, inverse, RREF, rank, eigen, LU, QR', 'Vectors in 2D / 3D: dot, cross, angle, projection'],
  solver: ['Polynomials up to degree 10 with complex roots', 'Simultaneous linear equations', 'Any equation f(x) = g(x)', 'Inequalities as intervals, ratios A:B = C:D'],
  calculus: ['Symbolic derivatives and antiderivatives', 'Definite integrals (also to ∞), limits, Taylor series, Σ and Π', 'Simplify, expand and factor (CAS)'],
  stats: ['1-variable statistics with frequencies, histogram, box plot', '9 regression models with “send to graph”', '9 probability distributions', 'z / t / proportion / χ² tests and confidence intervals'],
  table: ['Tables of f(x), g(x), h(x) with start / end / step', 'Explicit and recursive sequences u(n), v(n), sums, detection of arithmetic / geometric'],
  sheet: ['Spreadsheet cells with formulas, ranges (Sum(A1:A10)), fill down / right', 'CSV import and export'],
  finance: ['Time value of money (N, I/Y, PV, PMT, FV)', 'Loans, amortisation, NPV / IRR, depreciation, percentages'],
  units: ['18 unit categories and free-form conversions', 'Date differences and date arithmetic'],
  code: ['Write JavaScript or Python programs', 'A function library shared by every mode'],
  developers: ['REST API, JavaScript SDK and embeddable widgets'],
};

/** Where familiar calculator features live in Calci. */
const SWITCH: { from: string; rows: [string, string, string][] }[] = [
  {
    from: 'Casio fx-991ES / EX / CW (ClassWiz)',
    rows: [
      ['Natural textbook display (MathI/O)', 'scientific', 'On by default — “Textbook” in the display bar'],
      ['S⇔D, FORMAT (fraction, decimal, recurring, D°M′S″)', 'scientific', 'S⇔D key, and the answer-form chips under every result'],
      ['CALC (enter values for X)', 'scientific', 'Type an expression with letters — value boxes appear'],
      ['SOLVE', 'scientific', '2nd + lim key, or the Equation Solver'],
      ['∫, d/dx, Σ, Π', 'scientific', 'Keypad keys with boxes to fill'],
      ['EQUATION / FUNC (polynomial, simultaneous)', 'solver', 'Polynomial and Linear system tabs'],
      ['INEQUALITY', 'solver', 'Inequality tab'],
      ['RATIO', 'solver', 'Ratio tab'],
      ['TABLE', 'table', 'Function table with start / end / step'],
      ['MATRIX / VECTOR', 'matrix', 'Matrices and Vectors tabs'],
      ['STAT, DISTRIBUTION', 'stats', 'Data, Regression and Distributions tabs'],
      ['SPREADSHEET', 'sheet', 'Spreadsheet mode'],
      ['BASE-N', 'programmer', 'Programmer mode'],
      ['COMPLEX (a+bi, r∠θ)', 'scientific', 'Use i; the polar form appears under the result. Pol / Rec keys'],
      ['VERIFY', 'scientific', 'Type an equation such as 1/2 + 1/3 = 5/6'],
      ['÷R (quotient & remainder)', 'scientific', '÷R key: quorem(17, 5) = 3 R 2'],
      ['Unit conversions & constants', 'units', 'Converter mode; constants in the Scientific side panel'],
    ],
  },
  {
    from: 'TI-84 Plus CE / TI-Nspire',
    rows: [
      ['Y= editor, GRAPH, TRACE, CALC menu (zero, min, max, intersect)', 'graph', 'Graphing: tap the grey points to read coordinates'],
      ['Window / Zoom Fit / ZStandard', 'graph', 'Settings → Window, the ⤢ Zoom-to-fit and ⌂ buttons'],
      ['Polar, Parametric, Sequence graphs', 'graph', 'Type r = …, (x(t), y(t)); sequences live in Table & Sequences'],
      ['Table (2nd GRAPH)', 'table', 'Table mode'],
      ['Lists & STAT CALC (1-Var, LinReg…)', 'stats', 'Data & Regression tabs'],
      ['DISTR (normalcdf, invNorm, binompdf…)', 'stats', 'Distributions tab — also usable as functions anywhere'],
      ['STAT TESTS (Z-Test, T-Test, 1-PropZ, χ²…)', 'stats', 'Tests & intervals tab'],
      ['Finance app (TVM Solver)', 'finance', 'Time value of money tab'],
      ['Programs (TI-Basic / Python)', 'code', 'JavaScript and Python programs'],
      ['Nspire CAS: factor, expand, ∫ symbolic', 'calculus', 'Algebra (CAS) tab and the antiderivative in the Integral tab'],
      ['3D graphing', '3d', '3D Surfaces mode'],
    ],
  },
  {
    from: 'Desmos',
    rows: [
      ['Expression list with sliders', 'graph', 'Unknown letters offer “Add slider”, ▶ animates'],
      ['Implicit equations & inequalities', 'graph', 'x^2 + y^2 = 9, y < x^2 — shaded automatically'],
      ['Restrictions {…} and piecewise', 'graph', 'y = x^2 {0 < x < 2},  y = {x < 0: -x, x}'],
      ["f(x) and f'(x)", 'graph', "Define f(x) = …, then y = f'(x)"],
      ['Points and tables', 'graph', '(1, 2), (3, 4) — tables in Table mode, regression in Statistics'],
      ['Keypad of functions', 'graph', '“Functions” button above the expression list'],
      ['3D calculator', '3d', '3D Surfaces mode'],
      ['Share link / embed', 'graph', 'Share button → link, PNG, SVG or embed code'],
    ],
  },
];

const SHORTCUTS: [string, string][] = [
  ['Ctrl + K', 'Search, jump to a mode, or quick-calculate'],
  ['Alt + 1…9', 'Switch mode'],
  ['Enter', 'Evaluate / new graph expression'],
  ['Esc', 'Clear the input'],
  ['↑ / ↓', 'Recall history (linear input) — Ctrl + ↑ in textbook input'],
  ['/', 'Fraction (textbook input)'],
  ['^', 'Power — the caret moves into the exponent'],
  ['→ / Tab', 'Next empty box in a template'],
  ['Ctrl + Enter', 'Run a program (Code mode)'],
  ['Ctrl + ,', 'Settings'],
];

export default function Guide() {
  const [tab, setTab] = useState<Tab>('start');
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();

  const hits = useMemo(() => {
    if (!query) return null;
    const has = (s: string) => s.toLowerCase().includes(query);
    return {
      modes: MODES.filter((m) => m.id !== 'guide' && (has(m.label) || has(m.description) || has(m.keywords) || (MODE_FEATURES[m.id] ?? []).some(has))),
      fns: FN_DOCS.filter((d) => has(d.name) || has(d.desc) || has(d.cat)).slice(0, 30),
      examples: GRAPH_EXAMPLES.flatMap((c) => c.items.filter((e) => has(e.title) || has(e.desc) || has(c.title) || e.exprs.some((x) => has(typeof x === 'string' ? x : x.text))).map((e) => ({ c, e }))).slice(0, 12),
      switch: SWITCH.flatMap((s) => s.rows.filter((r) => has(r[0]) || has(r[2])).map((r) => ({ from: s.from, r }))).slice(0, 12),
    };
  }, [query]);

  return (
    <div className="page guide">
      <section className="guide-hero">
        <h2>What can Calci do?</h2>
        <p className="muted">
          {MODES.length - 1} calculators in one — scientific, graphing, 3D, CAS, statistics, finance and more. Search for anything, or browse below.
        </p>
        <label className="guide-search">
          <Search size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: “integral”, “polar”, “regression”, “TABLE”, “hex”…" aria-label="Search the guide" autoFocus />
        </label>
      </section>

      {hits ? (
        <SearchResults hits={hits} />
      ) : (
        <>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'start', label: 'All modes' },
              { id: 'switch', label: 'Coming from Casio / TI / Desmos' },
              { id: 'plot', label: 'What can I plot?' },
              { id: 'functions', label: 'Every function' },
              { id: 'keys', label: 'Tips & shortcuts' },
            ]}
          />
          {tab === 'start' && <ModeCards />}
          {tab === 'switch' && <SwitchTables />}
          {tab === 'plot' && <PlotGuide />}
          {tab === 'functions' && <FunctionList />}
          {tab === 'keys' && <Tips />}
        </>
      )}
    </div>
  );
}

function ModeCards() {
  return (
    <div className="guide-cards">
      {MODES.filter((m) => m.id !== 'guide').map((m) => {
        const Icon = m.icon;
        return (
          <article key={m.id} className="guide-card">
            <div className="row nowrap">
              <span className="guide-icon">
                <Icon size={18} />
              </span>
              <strong>{m.label}</strong>
            </div>
            <ul>
              {(MODE_FEATURES[m.id] ?? [m.description]).map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <button className="btn btn-secondary btn-sm" onClick={() => navigate(m.id)}>
              Open {m.short} <ArrowRight size={14} />
            </button>
          </article>
        );
      })}
    </div>
  );
}

function SwitchTables() {
  return (
    <div className="stack">
      {SWITCH.map((s) => (
        <section className="card" key={s.from}>
          <div className="card-header">
            <h3>{s.from}</h3>
          </div>
          <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
            <table className="table guide-table">
              <thead>
                <tr>
                  <th>You know it as</th>
                  <th>In Calci</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {s.rows.map(([feature, mode, how]) => (
                  <tr key={feature}>
                    <td>{feature}</td>
                    <td>
                      <strong>{findMode(mode)?.label}</strong>
                      <div className="small muted">{how}</div>
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => navigate(mode)}>
                        Open <ArrowRight size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function PlotGuide() {
  return (
    <div className="stack">
      <p className="muted">
        Everything below can be typed into Graphing. Click <strong>Try</strong> to open an example, then change it. The same examples are in the graph’s <strong>Examples</strong> button.
      </p>
      {GRAPH_EXAMPLES.map((c) => (
        <section className="card card-pad stack-sm" key={c.id}>
          <div className="row">
            <h3 style={{ fontSize: 15 }}>{c.title}</h3>
          </div>
          <p className="small muted">{c.blurb}</p>
          <code className="guide-syntax">{c.syntax}</code>
          <div className="guide-examples">
            {c.items.map((e) => (
              <button
                key={e.title}
                className="guide-example"
                onClick={() => {
                  applyExample(e, 'replace');
                  navigate('graph');
                }}
                title={e.exprs.map((x) => (typeof x === 'string' ? x : x.text)).join('\n')}
              >
                <span>{e.title}</span>
                <span className="small muted">Try →</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function FunctionList() {
  const cats = [...new Set(FN_DOCS.map((d) => d.cat))];
  return (
    <div className="guide-fns">
      {cats.map((cat) => (
        <section className="card card-pad stack-sm" key={cat}>
          <h3 style={{ fontSize: 14 }}>{cat}</h3>
          {FN_DOCS.filter((d) => d.cat === cat).map((d) => (
            <button key={d.name} className="guide-fn" onClick={() => copyText(d.sig, `Copied ${d.sig}`)} title="Copy">
              <code>{d.sig}</code>
              <span className="small muted">{d.desc}</span>
              <Copy size={13} className="muted" />
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

function Tips() {
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="card card-pad stack-sm">
        <div className="section-title">Keyboard</div>
        {SHORTCUTS.map(([k, d]) => (
          <div className="row nowrap guide-key" key={k}>
            <kbd>{k}</kbd>
            <span className="small">{d}</span>
          </div>
        ))}
      </section>
      <section className="card card-pad stack-sm">
        <div className="section-title">Good to know</div>
        <ul className="guide-list">
          <li>Implicit multiplication works: 2x, 3sin(x), 2πr.</li>
          <li>Percent: 200 + 10% = 220. Units: 5 km to mi. Degrees: sin(30°).</li>
          <li>log is base 10, ln is natural; log₂(8) via log(8, 2) or the logₐ key.</li>
          <li>Define your own functions once in Code &amp; Library and use them everywhere — even in graphs.</li>
          <li>Settings (gear icon): angle unit, number format, digit grouping, exact answers, high precision, theme and colour.</li>
          <li>Everything is saved on your device and works offline after the first visit.</li>
          <li>Statistics → Regression → “Send to graph” plots your data and the fitted curve.</li>
        </ul>
      </section>
    </div>
  );
}

function SearchResults({ hits }: { hits: NonNullable<ReturnType<typeof useHitsShape>> }) {
  const empty = !hits.modes.length && !hits.fns.length && !hits.examples.length && !hits.switch.length;
  if (empty) return <div className="empty">Nothing found. Try another word — or ask in Ctrl + K to calculate it directly.</div>;
  return (
    <div className="stack">
      {hits.modes.length > 0 && (
        <section className="stack-sm">
          <div className="section-title">Modes</div>
          <div className="guide-examples">
            {hits.modes.map((m) => (
              <button key={m.id} className="guide-example" onClick={() => navigate(m.id)}>
                <span>{m.label}</span>
                <span className="small muted">{m.description}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {hits.switch.length > 0 && (
        <section className="stack-sm">
          <div className="section-title">Familiar features</div>
          {hits.switch.map(({ from, r }) => (
            <button key={from + r[0]} className="guide-fn" onClick={() => navigate(r[1])}>
              <span>
                <strong>{r[0]}</strong> <span className="small muted">({from})</span>
              </span>
              <span className="small muted">
                {findMode(r[1])?.label} — {r[2]}
              </span>
              <ArrowRight size={13} />
            </button>
          ))}
        </section>
      )}
      {hits.examples.length > 0 && (
        <section className="stack-sm">
          <div className="section-title">Graph examples</div>
          <div className="guide-examples">
            {hits.examples.map(({ c, e }) => (
              <button
                key={c.id + e.title}
                className="guide-example"
                onClick={() => {
                  applyExample(e, 'replace');
                  navigate('graph');
                }}
              >
                <span>{e.title}</span>
                <span className="small muted">{c.title} · Try →</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {hits.fns.length > 0 && (
        <section className="stack-sm">
          <div className="section-title">Functions</div>
          {hits.fns.map((d) => (
            <button key={d.name} className="guide-fn" onClick={() => copyText(d.sig, `Copied ${d.sig}`)}>
              <code>{d.sig}</code>
              <span className="small muted">{d.desc}</span>
              <Copy size={13} className="muted" />
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

// type helper for SearchResults props
function useHitsShape() {
  return null as null | {
    modes: typeof MODES;
    fns: typeof FN_DOCS;
    examples: { c: (typeof GRAPH_EXAMPLES)[number]; e: (typeof GRAPH_EXAMPLES)[number]['items'][number] }[];
    switch: { from: string; r: [string, string, string] }[];
  };
}
