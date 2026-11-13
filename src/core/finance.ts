/**
 * Financial mathematics: time value of money (TVM) solver, amortisation,
 * NPV / IRR / MIRR, payback, interest conversion and depreciation.
 *
 * Sign convention (cash-flow sign): money received is positive, money paid is
 * negative. E.g. a loan: PV = +200000 (received), PMT negative (paid).
 */
import { brent, clean } from './numerics.js';

export type TvmKey = 'n' | 'iy' | 'pv' | 'pmt' | 'fv';

export interface TvmInput {
  /** Number of payment periods. */
  n: number;
  /** Nominal annual interest rate in percent. */
  iy: number;
  pv: number;
  pmt: number;
  fv: number;
  /** Payments per year. */
  py: number;
  /** Compounding periods per year. */
  cy: number;
  /** Payments at the beginning of each period (annuity due). */
  begin: boolean;
}

export const DEFAULT_TVM: TvmInput = { n: 360, iy: 6, pv: 200000, pmt: 0, fv: 0, py: 12, cy: 12, begin: false };

/** Effective interest rate per payment period. */
export function periodicRate(iy: number, py: number, cy: number): number {
  return Math.pow(1 + iy / 100 / cy, cy / py) - 1;
}

function tvmEquation(v: TvmInput, i: number): number {
  const { n, pv, pmt, fv, begin } = v;
  if (Math.abs(i) < 1e-12) return pv + pmt * n + fv;
  const g = Math.pow(1 + i, n);
  return pv * g + pmt * (1 + i * (begin ? 1 : 0)) * ((g - 1) / i) + fv;
}

/** Solve for one TVM variable given the rest. */
export function solveTvm(v: TvmInput, target: TvmKey): number {
  const i = periodicRate(v.iy, v.py, v.cy);
  const k = v.begin ? 1 : 0;
  const { n, pv, pmt, fv } = v;
  switch (target) {
    case 'fv': {
      if (Math.abs(i) < 1e-12) return clean(-(pv + pmt * n), 12);
      const g = Math.pow(1 + i, n);
      return clean(-(pv * g + (pmt * (1 + i * k) * (g - 1)) / i), 12);
    }
    case 'pv': {
      if (Math.abs(i) < 1e-12) return clean(-(fv + pmt * n), 12);
      const g = Math.pow(1 + i, n);
      return clean(-(fv + (pmt * (1 + i * k) * (g - 1)) / i) / g, 12);
    }
    case 'pmt': {
      if (Math.abs(i) < 1e-12) return clean(-(pv + fv) / n, 12);
      const g = Math.pow(1 + i, n);
      return clean((-(pv * g + fv) * i) / ((1 + i * k) * (g - 1)), 12);
    }
    case 'n': {
      if (Math.abs(i) < 1e-12) return clean(-(pv + fv) / pmt, 12);
      const a = pmt * (1 + i * k);
      const num = a - fv * i;
      const den = a + pv * i;
      const r = Math.log(num / den) / Math.log(1 + i);
      if (!Number.isFinite(r)) throw new Error('No solution for N with these values');
      return clean(r, 12);
    }
    case 'iy': {
      const f = (rate: number) => tvmEquation(v, rate);
      // scan for a bracket
      let lo = -0.9999;
      let prev = f(lo);
      let root = NaN;
      for (let x = -0.99; x <= 10; x += x < 0.2 ? 0.0005 : 0.01) {
        const cur = f(x);
        if (Number.isFinite(prev) && Number.isFinite(cur) && prev * cur <= 0) {
          root = brent(f, lo, x, 1e-15);
          break;
        }
        lo = x;
        prev = cur;
      }
      if (Number.isNaN(root)) throw new Error('No interest rate solves these values (check signs)');
      // convert periodic rate back to nominal annual percent
      const nominal = (Math.pow(1 + root, v.py / v.cy) - 1) * v.cy * 100;
      return clean(nominal, 10);
    }
  }
}

export interface AmortRow {
  period: number;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
  totalInterest: number;
}

/** Amortisation schedule for a loan (uses TVM values; PMT computed if 0). */
export function amortization(v: TvmInput): AmortRow[] {
  const i = periodicRate(v.iy, v.py, v.cy);
  const pmt = v.pmt || solveTvm(v, 'pmt');
  const rows: AmortRow[] = [];
  let bal = v.pv;
  let totalInterest = 0;
  const n = Math.min(Math.ceil(v.n), 5000);
  for (let p = 1; p <= n; p++) {
    let interest: number;
    if (v.begin && p === 1) interest = 0;
    else interest = -(bal + (v.begin ? pmt : 0)) * i;
    if (!v.begin) interest = -bal * i;
    const principal = pmt - interest;
    bal = bal + principal;
    totalInterest += interest;
    rows.push({ period: p, payment: pmt, interest, principal, balance: Math.abs(bal) < 1e-7 ? 0 : bal, totalInterest });
  }
  return rows;
}

export function npv(ratePercent: number, cashflows: number[], freq?: number[]): number {
  const r = ratePercent / 100;
  let t = 0;
  let sum = 0;
  cashflows.forEach((cf, idx) => {
    const f = Math.max(1, Math.round(freq?.[idx] ?? 1));
    for (let k = 0; k < f; k++) {
      sum += cf / Math.pow(1 + r, t);
      t++;
    }
  });
  return sum;
}

/** Internal rate of return in percent. */
export function irr(cashflows: number[], freq?: number[]): number {
  const f = (r: number) => npv(r, cashflows, freq);
  const candidates: number[] = [];
  let lo = -99.9;
  let prev = f(lo);
  for (let x = -99; x <= 1000; x += x < 100 ? 0.25 : 5) {
    const cur = f(x);
    if (Number.isFinite(prev) && Number.isFinite(cur) && prev * cur <= 0) {
      candidates.push(brent(f, lo, x, 1e-13));
    }
    lo = x;
    prev = cur;
  }
  if (!candidates.length) throw new Error('IRR not found (cash flows need at least one sign change)');
  // prefer the root closest to 10%
  candidates.sort((a, b) => Math.abs(a - 10) - Math.abs(b - 10));
  return clean(candidates[0], 10);
}

export function mirr(cashflows: number[], financeRate: number, reinvestRate: number): number {
  const n = cashflows.length - 1;
  let pvNeg = 0;
  let fvPos = 0;
  cashflows.forEach((cf, t) => {
    if (cf < 0) pvNeg += cf / Math.pow(1 + financeRate / 100, t);
    else fvPos += cf * Math.pow(1 + reinvestRate / 100, n - t);
  });
  return clean((Math.pow(fvPos / -pvNeg, 1 / n) - 1) * 100, 10);
}

/** Payback period (simple or discounted) in periods, NaN if never paid back. */
export function payback(cashflows: number[], discountRatePercent = 0): number {
  let cum = 0;
  for (let t = 0; t < cashflows.length; t++) {
    const cf = cashflows[t] / Math.pow(1 + discountRatePercent / 100, t);
    const prev = cum;
    cum += cf;
    if (t > 0 && prev < 0 && cum >= 0) return clean(t - 1 + -prev / cf, 10);
  }
  return NaN;
}

export function nominalToEffective(nominalPercent: number, periods: number): number {
  if (!Number.isFinite(periods)) return clean((Math.exp(nominalPercent / 100) - 1) * 100, 12);
  return clean((Math.pow(1 + nominalPercent / 100 / periods, periods) - 1) * 100, 12);
}

export function effectiveToNominal(effectivePercent: number, periods: number): number {
  if (!Number.isFinite(periods)) return clean(Math.log(1 + effectivePercent / 100) * 100, 12);
  return clean((Math.pow(1 + effectivePercent / 100, 1 / periods) - 1) * periods * 100, 12);
}

export type DepreciationMethod = 'sl' | 'db' | 'ddb' | 'syd';

export interface DepRow {
  year: number;
  depreciation: number;
  accumulated: number;
  bookValue: number;
}

/** Depreciation schedule: straight-line, declining balance (rate %), double-declining, sum-of-years-digits. */
export function depreciation(cost: number, salvage: number, life: number, method: DepreciationMethod, dbRatePercent = 150): DepRow[] {
  const rows: DepRow[] = [];
  let book = cost;
  let acc = 0;
  const years = Math.max(1, Math.round(life));
  const syd = (years * (years + 1)) / 2;
  for (let y = 1; y <= years; y++) {
    let d: number;
    switch (method) {
      case 'sl':
        d = (cost - salvage) / years;
        break;
      case 'syd':
        d = ((cost - salvage) * (years - y + 1)) / syd;
        break;
      case 'ddb':
      case 'db': {
        const rate = (method === 'ddb' ? 200 : dbRatePercent) / 100 / years;
        d = book * rate;
        // switch to straight-line when it is larger (standard practice)
        const sl = (book - salvage) / (years - y + 1);
        if (sl > d) d = sl;
        if (book - d < salvage) d = book - salvage;
        break;
      }
    }
    d = Math.max(0, d);
    acc += d;
    book -= d;
    rows.push({ year: y, depreciation: d, accumulated: acc, bookValue: book });
  }
  return rows;
}

export function compoundInterest(principal: number, ratePercent: number, years: number, perYear = 1, contribution = 0) {
  const i = ratePercent / 100 / perYear;
  const n = years * perYear;
  const g = Math.pow(1 + i, n);
  const fv = principal * g + (i === 0 ? contribution * n : (contribution * (g - 1)) / i);
  const totalContrib = principal + contribution * n;
  return { futureValue: fv, totalContributions: totalContrib, interestEarned: fv - totalContrib };
}

/** Equated monthly instalment for a loan. */
export function loanPayment(principal: number, annualRatePercent: number, months: number) {
  const r = annualRatePercent / 100 / 12;
  const pmt = r === 0 ? principal / months : (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
  return { payment: pmt, totalPaid: pmt * months, totalInterest: pmt * months - principal };
}
