import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { finance } from '../../core/index';
import type { TvmInput, TvmKey, DepreciationMethod } from '../../core/finance';
import { Tabs, NumberInput, Segmented, fmt, money } from '../ui';
import { Plot } from '../components/Plot';
import '../../styles/modes/tools.css';

type Tab = 'tvm' | 'loan' | 'cash' | 'interest' | 'dep' | 'pct';

export default function Finance() {
  const [tab, setTab] = useState<Tab>('tvm');
  return (
    <div className="page wide">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'tvm', label: 'Time value of money' },
          { id: 'loan', label: 'Loan / EMI' },
          { id: 'cash', label: 'Cash flows · NPV · IRR' },
          { id: 'interest', label: 'Interest & growth' },
          { id: 'dep', label: 'Depreciation' },
          { id: 'pct', label: 'Percentages' },
        ]}
      />
      {tab === 'tvm' && <Tvm />}
      {tab === 'loan' && <Loan />}
      {tab === 'cash' && <CashFlows />}
      {tab === 'interest' && <Interest />}
      {tab === 'dep' && <Depreciation />}
      {tab === 'pct' && <Percent />}
    </div>
  );
}

const TVM_FIELDS: { key: TvmKey; label: string; hint: string }[] = [
  { key: 'n', label: 'N', hint: 'Number of payments' },
  { key: 'iy', label: 'I/Y %', hint: 'Annual interest rate' },
  { key: 'pv', label: 'PV', hint: 'Present value (+ received)' },
  { key: 'pmt', label: 'PMT', hint: 'Payment each period (− paid)' },
  { key: 'fv', label: 'FV', hint: 'Future value' },
];

function Tvm() {
  const [v, setV] = useState<TvmInput>({ ...finance.DEFAULT_TVM, pmt: -1199.10 });
  const [target, setTarget] = useState<TvmKey>('pmt');
  const [showAll, setShowAll] = useState(false);
  const solved = useMemo(() => {
    try {
      return { value: finance.solveTvm(v, target), error: null };
    } catch (e) {
      return { value: NaN, error: (e as Error).message };
    }
  }, [v, target]);
  const full: TvmInput = { ...v, [target]: solved.value };
  const schedule = useMemo(() => (Number.isFinite(solved.value) && full.n > 0 && full.n <= 5000 ? finance.amortization(full) : []), [JSON.stringify(full)]);
  const totalPaid = full.pmt * full.n;
  return (
    <div className="stack">
      <section className="card card-pad stack">
        <div className="tvm-grid">
          {TVM_FIELDS.map((f) => (
            <div key={f.key} className={`tvm-field${target === f.key ? ' target' : ''}`}>
              <div className="row">
                <strong>{f.label}</strong>
                <button className={`btn btn-sm ${target === f.key ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTarget(f.key)} title="Solve for this value">
                  {target === f.key ? 'Solving' : 'Solve'}
                </button>
              </div>
              {target === f.key ? (
                <div className="result-value num" style={{ fontSize: 20, minHeight: 36, display: 'flex', alignItems: 'center' }}>
                  {solved.error ? '—' : f.key === 'n' || f.key === 'iy' ? fmt(solved.value, 10) : money(solved.value)}
                </div>
              ) : (
                <NumberInput value={v[f.key]} onChange={(val) => setV({ ...v, [f.key]: val })} ariaLabel={f.label} />
              )}
              <span className="small muted">{f.hint}</span>
            </div>
          ))}
        </div>
        <div className="row">
          <span className="label">Payments / year</span>
          <div style={{ width: 80 }}>
            <NumberInput value={v.py} onChange={(py) => setV({ ...v, py })} />
          </div>
          <span className="label">Compounding / year</span>
          <div style={{ width: 80 }}>
            <NumberInput value={v.cy} onChange={(cy) => setV({ ...v, cy })} />
          </div>
          <Segmented
            size="sm"
            value={v.begin ? 'b' : 'e'}
            onChange={(x) => setV({ ...v, begin: x === 'b' })}
            options={[
              { value: 'e', label: 'END' },
              { value: 'b', label: 'BEGIN' },
            ]}
          />
        </div>
        {solved.error && <div className="error-text">{solved.error}</div>}
        <p className="small muted">Cash-flow sign convention: money you receive is positive, money you pay is negative. For a loan, PV is positive and PMT negative.</p>
      </section>
      {schedule.length > 0 && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <section className="card card-pad stack-sm">
            <div className="section-title">Summary</div>
            <div className="stat-grid">
              <div className="stat">
                <div className="k">Total of payments</div>
                <div className="v">{money(Math.abs(totalPaid))}</div>
              </div>
              <div className="stat">
                <div className="k">Total interest</div>
                <div className="v">{money(Math.abs(schedule[schedule.length - 1].totalInterest))}</div>
              </div>
              <div className="stat">
                <div className="k">Effective annual rate</div>
                <div className="v">{fmt(finance.nominalToEffective(full.iy, full.cy), 8)}%</div>
              </div>
            </div>
            <Plot
              x={[0, schedule.length]}
              series={[
                { type: 'line', pts: [[0, full.pv], ...schedule.map((r) => [r.period, r.balance] as [number, number])], color: '#4F46E5', label: 'balance' },
                { type: 'line', pts: [[0, 0], ...schedule.map((r) => [r.period, -r.totalInterest] as [number, number])], color: '#E11D48', label: 'interest' },
              ]}
              height={240}
              xLabel="period"
            />
          </section>
          <section className="card stack-sm" style={{ overflow: 'hidden' }}>
            <div className="card-header">
              <h3>Amortisation schedule</h3>
              <div className="spacer" />
              {schedule.length > 24 && (
                <button className="btn btn-ghost btn-sm" onClick={() => setShowAll((s) => !s)}>
                  {showAll ? 'Show fewer' : `Show all ${schedule.length}`}
                </button>
              )}
            </div>
            <div className="table-wrap" style={{ border: 0, borderRadius: 0, maxHeight: 420 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Payment</th>
                    <th>Interest</th>
                    <th>Principal</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {(showAll ? schedule : schedule.slice(0, 24)).map((r) => (
                    <tr key={r.period}>
                      <td>{r.period}</td>
                      <td>{money(r.payment)}</td>
                      <td>{money(r.interest)}</td>
                      <td>{money(r.principal)}</td>
                      <td>{money(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Loan() {
  const [principal, setPrincipal] = useState(500000);
  const [rate, setRate] = useState(8.5);
  const [years, setYears] = useState(20);
  const months = Math.round(years * 12);
  const r = finance.loanPayment(principal, rate, months);
  const sched = useMemo(() => finance.amortization({ n: months, iy: rate, pv: principal, pmt: -r.payment, fv: 0, py: 12, cy: 12, begin: false }), [months, rate, principal, r.payment]);
  const yearly = useMemo(() => {
    const out: { year: number; principal: number; interest: number; balance: number }[] = [];
    for (let y = 0; y < Math.ceil(months / 12); y++) {
      const rows = sched.slice(y * 12, y * 12 + 12);
      out.push({ year: y + 1, principal: -rows.reduce((s, x) => s + x.principal, 0), interest: -rows.reduce((s, x) => s + x.interest, 0), balance: rows[rows.length - 1]?.balance ?? 0 });
    }
    return out;
  }, [sched, months]);
  const interestShare = r.totalInterest / r.totalPaid;
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="card card-pad stack">
        <div className="field-row">
          <div className="field">
            <label>Loan amount</label>
            <NumberInput value={principal} onChange={setPrincipal} />
          </div>
          <div className="field">
            <label>Annual interest rate %</label>
            <NumberInput value={rate} onChange={setRate} />
          </div>
          <div className="field">
            <label>Term (years)</label>
            <NumberInput value={years} onChange={setYears} />
          </div>
        </div>
        <div className="result-box accent">
          <div className="result-label">Monthly payment (EMI)</div>
          <div className="result-value num">{money(r.payment)}</div>
        </div>
        <div className="stat-grid">
          <div className="stat">
            <div className="k">Total interest</div>
            <div className="v">{money(r.totalInterest)}</div>
          </div>
          <div className="stat">
            <div className="k">Total paid</div>
            <div className="v">{money(r.totalPaid)}</div>
          </div>
          <div className="stat">
            <div className="k">Interest share</div>
            <div className="v">{fmt(interestShare * 100, 4)}%</div>
          </div>
        </div>
        <div className="loan-bar" aria-label="Principal versus interest" style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden' }}>
          <span style={{ flex: 1 - interestShare, background: 'var(--accent)' }} />
          <span style={{ flex: interestShare, background: '#E11D48' }} />
        </div>
        <div className="row small muted">
          <span style={{ color: 'var(--accent-text)' }}>■</span> Principal <span style={{ color: '#E11D48', marginLeft: 10 }}>■</span> Interest
        </div>
      </section>
      <section className="card" style={{ overflow: 'hidden' }}>
        <div className="card-header">
          <h3>Year by year</h3>
        </div>
        <div className="table-wrap" style={{ border: 0, borderRadius: 0, maxHeight: 460 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Year</th>
                <th>Principal paid</th>
                <th>Interest paid</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {yearly.map((y) => (
                <tr key={y.year}>
                  <td>{y.year}</td>
                  <td>{money(y.principal)}</td>
                  <td>{money(y.interest)}</td>
                  <td>{money(y.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function CashFlows() {
  const [flows, setFlows] = useState<{ cf: number; n: number }[]>([
    { cf: -10000, n: 1 },
    { cf: 3000, n: 1 },
    { cf: 4200, n: 1 },
    { cf: 6800, n: 1 },
  ]);
  const [rate, setRate] = useState(10);
  const [fin, setFin] = useState(8);
  const [reinv, setReinv] = useState(12);
  const cfs = flows.map((f) => f.cf);
  const freq = flows.map((f) => f.n);
  const expanded = flows.flatMap((f) => Array(Math.max(1, Math.round(f.n))).fill(f.cf));
  const npv = finance.npv(rate, cfs, freq);
  let irr = NaN;
  let irrErr = '';
  try {
    irr = finance.irr(cfs, freq);
  } catch (e) {
    irrErr = (e as Error).message;
  }
  let mirr = NaN;
  try {
    mirr = finance.mirr(expanded, fin, reinv);
  } catch {
    /* ignore */
  }
  const pb = finance.payback(expanded);
  const dpb = finance.payback(expanded, rate);
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="card card-pad stack-sm">
        <div className="cf-row small muted">
          <span>#</span>
          <span>Cash flow</span>
          <span>Repeat ×</span>
          <span />
        </div>
        {flows.map((f, i) => (
          <div className="cf-row" key={i}>
            <span className="small muted">CF{i}</span>
            <NumberInput value={f.cf} onChange={(cf) => setFlows(flows.map((x, k) => (k === i ? { ...x, cf } : x)))} ariaLabel={`Cash flow ${i}`} />
            <NumberInput value={f.n} onChange={(n) => setFlows(flows.map((x, k) => (k === i ? { ...x, n } : x)))} ariaLabel={`Frequency ${i}`} />
            <button className="icon-btn sm" onClick={() => setFlows(flows.filter((_, k) => k !== i))} aria-label="Remove" disabled={flows.length <= 2}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setFlows([...flows, { cf: 0, n: 1 }])}>
          <Plus size={14} /> Add cash flow
        </button>
        <div className="field-row">
          <div className="field">
            <label>Discount rate %</label>
            <NumberInput value={rate} onChange={setRate} />
          </div>
          <div className="field">
            <label>Finance rate % (MIRR)</label>
            <NumberInput value={fin} onChange={setFin} />
          </div>
          <div className="field">
            <label>Reinvest rate % (MIRR)</label>
            <NumberInput value={reinv} onChange={setReinv} />
          </div>
        </div>
      </section>
      <section className="card card-pad stack">
        <div className="stat-grid">
          <div className="stat">
            <div className="k">NPV @ {rate}%</div>
            <div className="v" style={{ color: npv >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {money(npv)}
            </div>
          </div>
          <div className="stat">
            <div className="k">IRR</div>
            <div className="v">{Number.isFinite(irr) ? `${fmt(irr, 8)}%` : '—'}</div>
          </div>
          <div className="stat">
            <div className="k">MIRR</div>
            <div className="v">{Number.isFinite(mirr) ? `${fmt(mirr, 8)}%` : '—'}</div>
          </div>
          <div className="stat">
            <div className="k">Payback period</div>
            <div className="v">{Number.isFinite(pb) ? `${fmt(pb, 4)} periods` : 'never'}</div>
          </div>
          <div className="stat">
            <div className="k">Discounted payback</div>
            <div className="v">{Number.isFinite(dpb) ? `${fmt(dpb, 4)} periods` : 'never'}</div>
          </div>
        </div>
        {irrErr && <div className="small muted">{irrErr}</div>}
        <div className="section-title">NPV profile</div>
        <Plot x={[-5, Math.max(40, Number.isFinite(irr) ? irr * 1.6 : 40)]} series={[{ type: 'fn', f: (r) => finance.npv(r, cfs, freq), color: '#4F46E5', label: 'NPV' }]} height={240} xLabel="rate %" />
      </section>
    </div>
  );
}

function Interest() {
  const [nominal, setNominal] = useState(12);
  const [periods, setPeriods] = useState(12);
  const [principal, setPrincipal] = useState(10000);
  const [rate, setRate] = useState(7);
  const [years, setYears] = useState(15);
  const [perYear, setPerYear] = useState(12);
  const [contrib, setContrib] = useState(200);
  const eff = finance.nominalToEffective(nominal, periods);
  const g = finance.compoundInterest(principal, rate, years, perYear, contrib);
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="card card-pad stack">
        <div className="section-title">Nominal ↔ effective rate</div>
        <div className="field-row">
          <div className="field">
            <label>Nominal annual rate %</label>
            <NumberInput value={nominal} onChange={setNominal} />
          </div>
          <div className="field">
            <label>Compounding periods / year</label>
            <NumberInput value={periods} onChange={setPeriods} placeholder="Infinity = continuous" />
          </div>
        </div>
        <div className="result-box accent">
          <div className="result-label">Effective annual rate</div>
          <div className="result-value num">{fmt(eff, 10)}%</div>
        </div>
        <div className="small muted">Continuous compounding gives {fmt(finance.nominalToEffective(nominal, Infinity), 10)}%.</div>
      </section>
      <section className="card card-pad stack">
        <div className="section-title">Growth with regular contributions</div>
        <div className="field-row">
          <div className="field">
            <label>Starting amount</label>
            <NumberInput value={principal} onChange={setPrincipal} />
          </div>
          <div className="field">
            <label>Annual rate %</label>
            <NumberInput value={rate} onChange={setRate} />
          </div>
          <div className="field">
            <label>Years</label>
            <NumberInput value={years} onChange={setYears} />
          </div>
          <div className="field">
            <label>Periods / year</label>
            <NumberInput value={perYear} onChange={setPerYear} />
          </div>
          <div className="field">
            <label>Contribution / period</label>
            <NumberInput value={contrib} onChange={setContrib} />
          </div>
        </div>
        <div className="stat-grid">
          <div className="stat">
            <div className="k">Future value</div>
            <div className="v">{money(g.futureValue)}</div>
          </div>
          <div className="stat">
            <div className="k">Contributed</div>
            <div className="v">{money(g.totalContributions)}</div>
          </div>
          <div className="stat">
            <div className="k">Interest earned</div>
            <div className="v">{money(g.interestEarned)}</div>
          </div>
        </div>
        <Plot
          x={[0, Math.max(1, years)]}
          series={[
            { type: 'fn', f: (t) => finance.compoundInterest(principal, rate, t, perYear, contrib).futureValue, color: '#4F46E5', label: 'value' },
            { type: 'fn', f: (t) => principal + contrib * perYear * t, color: '#94A3B8', label: 'contributed', dash: [6, 5] },
          ]}
          height={220}
          xLabel="years"
        />
      </section>
    </div>
  );
}

function Depreciation() {
  const [cost, setCost] = useState(50000);
  const [salvage, setSalvage] = useState(5000);
  const [life, setLife] = useState(8);
  const [method, setMethod] = useState<DepreciationMethod>('sl');
  const [dbRate, setDbRate] = useState(150);
  const rows = useMemo(() => finance.depreciation(cost, salvage, life, method, dbRate), [cost, salvage, life, method, dbRate]);
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="card card-pad stack">
        <Segmented
          size="sm"
          value={method}
          onChange={setMethod}
          options={[
            { value: 'sl', label: 'Straight-line' },
            { value: 'ddb', label: 'Double declining' },
            { value: 'db', label: 'Declining %' },
            { value: 'syd', label: 'Sum of years' },
          ]}
        />
        <div className="field-row">
          <div className="field">
            <label>Cost</label>
            <NumberInput value={cost} onChange={setCost} />
          </div>
          <div className="field">
            <label>Salvage value</label>
            <NumberInput value={salvage} onChange={setSalvage} />
          </div>
          <div className="field">
            <label>Useful life (years)</label>
            <NumberInput value={life} onChange={setLife} />
          </div>
          {method === 'db' && (
            <div className="field">
              <label>Declining rate %</label>
              <NumberInput value={dbRate} onChange={setDbRate} />
            </div>
          )}
        </div>
        <Plot x={[0, rows.length]} series={[{ type: 'line', pts: [[0, cost], ...rows.map((r) => [r.year, r.bookValue] as [number, number])], color: '#4F46E5', label: 'book value' }]} height={220} xLabel="year" />
      </section>
      <section className="card" style={{ overflow: 'hidden' }}>
        <div className="table-wrap" style={{ border: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Year</th>
                <th>Depreciation</th>
                <th>Accumulated</th>
                <th>Book value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.year}>
                  <td>{r.year}</td>
                  <td>{money(r.depreciation)}</td>
                  <td>{money(r.accumulated)}</td>
                  <td>{money(r.bookValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Percent() {
  const [a, setA] = useState(80);
  const [b, setB] = useState(100);
  const [p, setP] = useState(15);
  const [price, setPrice] = useState(1200);
  const [cost, setCost] = useState(900);
  return (
    <div className="grid-3">
      <section className="card card-pad stack-sm">
        <div className="section-title">Change between two values</div>
        <div className="field-row">
          <div className="field">
            <label>From</label>
            <NumberInput value={a} onChange={setA} />
          </div>
          <div className="field">
            <label>To</label>
            <NumberInput value={b} onChange={setB} />
          </div>
        </div>
        <div className="result-box accent">
          <div className="result-label">Percentage change</div>
          <div className="result-value num">{fmt(((b - a) / Math.abs(a)) * 100, 8)}%</div>
        </div>
        <div className="small muted">
          {fmt(a)} is {fmt((a / b) * 100, 6)}% of {fmt(b)}.
        </div>
      </section>
      <section className="card card-pad stack-sm">
        <div className="section-title">Percent of a value</div>
        <div className="field-row">
          <div className="field">
            <label>Percent %</label>
            <NumberInput value={p} onChange={setP} />
          </div>
          <div className="field">
            <label>Of</label>
            <NumberInput value={b} onChange={setB} />
          </div>
        </div>
        <div className="stat-grid">
          <div className="stat">
            <div className="k">{fmt(p)}% of {fmt(b)}</div>
            <div className="v">{fmt((p / 100) * b)}</div>
          </div>
          <div className="stat">
            <div className="k">Increased by {fmt(p)}%</div>
            <div className="v">{fmt(b * (1 + p / 100))}</div>
          </div>
          <div className="stat">
            <div className="k">Decreased by {fmt(p)}%</div>
            <div className="v">{fmt(b * (1 - p / 100))}</div>
          </div>
        </div>
      </section>
      <section className="card card-pad stack-sm">
        <div className="section-title">Margin & markup</div>
        <div className="field-row">
          <div className="field">
            <label>Price</label>
            <NumberInput value={price} onChange={setPrice} />
          </div>
          <div className="field">
            <label>Cost</label>
            <NumberInput value={cost} onChange={setCost} />
          </div>
        </div>
        <div className="stat-grid">
          <div className="stat">
            <div className="k">Profit</div>
            <div className="v">{money(price - cost)}</div>
          </div>
          <div className="stat">
            <div className="k">Margin</div>
            <div className="v">{fmt(((price - cost) / price) * 100, 6)}%</div>
          </div>
          <div className="stat">
            <div className="k">Markup</div>
            <div className="v">{fmt(((price - cost) / cost) * 100, 6)}%</div>
          </div>
        </div>
      </section>
    </div>
  );
}
