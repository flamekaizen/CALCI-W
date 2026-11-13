import { useMemo, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { units } from '../../core/index';
import { Tabs, NumberInput, fmt, copyText } from '../ui';
import '../../styles/modes/tools.css';

const { UNIT_CATEGORIES, convertUnit, convertQuery } = units;

export default function Units() {
  const [tab, setTab] = useState<'units' | 'date'>('units');
  return (
    <div className="page">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'units', label: 'Units' },
          { id: 'date', label: 'Dates' },
        ]}
      />
      {tab === 'units' ? <UnitConverter /> : <DateCalc />}
    </div>
  );
}

const DEFAULT_PAIR: Record<string, [string, string]> = {
  length: ['km', 'mi'],
  mass: ['kg', 'lbm'],
  temperature: ['degC', 'degF'],
  volume: ['L', 'gallon'],
  speed: ['km/h', 'mi/h'],
  data: ['GB', 'GiB'],
  area: ['m2', 'sqft'],
  energy: ['kWh', 'J'],
  pressure: ['bar', 'psi'],
  time: ['hour', 'minute'],
  fuel: ['L/100km', 'mpg(US)'],
};

function UnitConverter() {
  const [catId, setCatId] = useState('length');
  const cat = UNIT_CATEGORIES.find((c) => c.id === catId)!;
  const [pairs, setPairs] = useState<Record<string, [string, string]>>({});
  const [from, to] = pairs[catId] ?? DEFAULT_PAIR[catId] ?? [cat.units[0].id, cat.units[1].id];
  const setPair = (f: string, t: string) => setPairs({ ...pairs, [catId]: [f, t] });
  const [value, setValue] = useState(1);
  const [query, setQuery] = useState('5 ft + 3 inch to cm');

  const conv = (u: string) => {
    try {
      return convertUnit(value, from, u, catId);
    } catch {
      return NaN;
    }
  };
  const result = conv(to);
  const q = useMemo(() => {
    if (!query.trim()) return null;
    try {
      return { r: convertQuery(query), error: null };
    } catch (e) {
      return { r: null, error: (e as Error).message.replace(/\s*\(char \d+\)$/, '') };
    }
  }, [query]);
  const sym = (id: string) => cat.units.find((u) => u.id === id)?.symbol ?? id;

  return (
    <div className="stack">
      <div className="unit-cats" role="tablist" aria-label="Categories">
        {UNIT_CATEGORIES.map((c) => (
          <button key={c.id} className={`unit-cat${c.id === catId ? ' active' : ''}`} onClick={() => setCatId(c.id)} role="tab" aria-selected={c.id === catId}>
            {c.label}
          </button>
        ))}
      </div>
      <section className="card card-pad stack">
        <div className="convert-main">
          <div className="stack-sm">
            <NumberInput className="big-input" value={value} onChange={setValue} ariaLabel="Value to convert" />
            <select className="select" value={from} onChange={(e) => setPair(e.target.value, to)} aria-label="From unit">
              {cat.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label} ({u.symbol})
                </option>
              ))}
            </select>
          </div>
          <button className="icon-btn" style={{ marginBottom: 6, alignSelf: 'center' }} onClick={() => setPair(to, from)} aria-label="Swap units" title="Swap">
            <ArrowLeftRight size={18} />
          </button>
          <div className="stack-sm">
            <button className="input big-input num" style={{ textAlign: 'left', background: 'var(--accent-soft)', borderColor: 'transparent' }} onClick={() => copyText(String(result))} title="Copy">
              {fmt(result, 12)}
            </button>
            <select className="select" value={to} onChange={(e) => setPair(from, e.target.value)} aria-label="To unit">
              {cat.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label} ({u.symbol})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="small muted">
          {fmt(value)} {sym(from)} = {fmt(result, 12)} {sym(to)}
        </div>
      </section>
      <section className="card card-pad stack-sm">
        <div className="section-title">
          {fmt(value)} {sym(from)} in every unit
        </div>
        <div className="unit-all">
          {cat.units
            .filter((u) => u.id !== from)
            .map((u) => {
              const v = conv(u.id);
              return (
                <button key={u.id} onClick={() => setPair(from, u.id)} title={`Convert to ${u.label}`}>
                  <span className="v">{fmt(v, 10)}</span>
                  <span className="u">
                    {u.label} ({u.symbol})
                  </span>
                </button>
              );
            })}
        </div>
      </section>
      <section className="card card-pad stack-sm">
        <div className="section-title">Free-form conversion</div>
        <input className="input mono" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. 60 mi/h to m/s, 2 acre to m^2, 3 cup to mL" aria-label="Conversion query" />
        {q?.r && (
          <div className="result-box accent">
            <span className="result-value num" style={{ fontSize: 18 }}>
              {fmt(q.r.value, 12)} {q.r.unit}
            </span>
          </div>
        )}
        {q?.error && <div className="error-text">{q.error}</div>}
        <div className="small muted">Combine units freely: 5 ft + 3 inch to cm, 1 kWh to BTU, 9.81 m/s^2 * 3 s to km/h.</div>
      </section>
    </div>
  );
}

const DAY = 86400000;
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const parseDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

function businessDays(a: Date, b: Date): number {
  const sign = b >= a ? 1 : -1;
  let [s, e] = sign > 0 ? [a, b] : [b, a];
  s = new Date(s);
  let n = 0;
  while (s < e) {
    const dow = s.getDay();
    if (dow !== 0 && dow !== 6) n++;
    s.setDate(s.getDate() + 1);
  }
  return n * sign;
}

function DateCalc() {
  const today = new Date();
  const [a, setA] = useState(iso(today));
  const [b, setB] = useState(iso(new Date(today.getFullYear(), 11, 31)));
  const [base, setBase] = useState(iso(today));
  const [add, setAdd] = useState(90);
  const [unit, setUnit] = useState<'days' | 'weeks' | 'months' | 'years'>('days');
  const da = parseDate(a);
  const db = parseDate(b);
  const days = Math.round((db.getTime() - da.getTime()) / DAY);
  let months = (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth());
  if (db.getDate() < da.getDate() && days > 0) months--;
  const y = Math.trunc(months / 12);
  const m = months % 12;
  const anchor = new Date(da.getFullYear(), da.getMonth() + months, da.getDate());
  const remDays = Math.round((db.getTime() - anchor.getTime()) / DAY);
  const target = new Date(parseDate(base));
  if (unit === 'days') target.setDate(target.getDate() + add);
  if (unit === 'weeks') target.setDate(target.getDate() + add * 7);
  if (unit === 'months') target.setMonth(target.getMonth() + add);
  if (unit === 'years') target.setFullYear(target.getFullYear() + add);
  const valid = !Number.isNaN(da.getTime()) && !Number.isNaN(db.getTime());
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="card card-pad stack">
        <div className="section-title">Difference between dates</div>
        <div className="field-row">
          <div className="field">
            <label>From</label>
            <input type="date" className="input" value={a} onChange={(e) => setA(e.target.value)} />
          </div>
          <div className="field">
            <label>To</label>
            <input type="date" className="input" value={b} onChange={(e) => setB(e.target.value)} />
          </div>
        </div>
        {valid && (
          <>
            <div className="result-box accent">
              <div className="result-label">Duration</div>
              <div className="result-value" style={{ fontSize: 20 }}>
                {y !== 0 && `${y} year${Math.abs(y) === 1 ? '' : 's'} `}
                {m !== 0 && `${m} month${Math.abs(m) === 1 ? '' : 's'} `}
                {`${remDays} day${Math.abs(remDays) === 1 ? '' : 's'}`}
              </div>
            </div>
            <div className="stat-grid">
              <div className="stat">
                <div className="k">Total days</div>
                <div className="v">{days.toLocaleString()}</div>
              </div>
              <div className="stat">
                <div className="k">Weeks</div>
                <div className="v">{fmt(days / 7, 6)}</div>
              </div>
              <div className="stat">
                <div className="k">Business days (Mon–Fri)</div>
                <div className="v">{Math.abs(days) < 200000 ? businessDays(da, db).toLocaleString() : '—'}</div>
              </div>
              <div className="stat">
                <div className="k">Hours</div>
                <div className="v">{(days * 24).toLocaleString()}</div>
              </div>
            </div>
          </>
        )}
      </section>
      <section className="card card-pad stack">
        <div className="section-title">Add or subtract time</div>
        <div className="field-row">
          <div className="field">
            <label>Start date</label>
            <input type="date" className="input" value={base} onChange={(e) => setBase(e.target.value)} />
          </div>
          <div className="field">
            <label>Amount (negative to subtract)</label>
            <NumberInput value={add} onChange={(v) => setAdd(Math.trunc(v))} />
          </div>
          <div className="field">
            <label>Unit</label>
            <select className="select" value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)}>
              <option value="days">Days</option>
              <option value="weeks">Weeks</option>
              <option value="months">Months</option>
              <option value="years">Years</option>
            </select>
          </div>
        </div>
        <div className="result-box accent">
          <div className="result-label">Resulting date</div>
          <div className="result-value" style={{ fontSize: 20 }}>
            {Number.isNaN(target.getTime()) ? '—' : target.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
      </section>
    </div>
  );
}
