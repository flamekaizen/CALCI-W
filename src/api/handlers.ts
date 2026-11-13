/**
 * Calci public REST API — framework-agnostic request handling.
 * Used by Vercel functions (api/v1/*), the Vite dev server and tests.
 */
import { Calculator, programmer, solver, calculus, stats, finance, units, graph, distributions, VERSION, prepare } from '../core/index.js';
import { validateUntrusted } from '../core/math.js';
import { setWorkBudget } from '../core/compile.js';
import type { RegressionModel } from '../core/stats.js';
import type { TvmInput, TvmKey } from '../core/finance.js';
import { FN_DOCS } from '../app/fnDocs.js';
import { openapi } from './openapi.js';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const MAX_EXPR = 2000;
const MAX_ARRAY = 10000;

type Params = Record<string, any>;

const str = (p: Params, k: string, def?: string): string => {
  const v = p[k] ?? def;
  if (typeof v !== 'string' || !v.trim()) throw new ApiError(400, `Parameter "${k}" is required`);
  if (v.length > MAX_EXPR) throw new ApiError(413, `Parameter "${k}" is too long (max ${MAX_EXPR} characters)`);
  return v;
};
const num = (p: Params, k: string, def?: number): number => {
  const raw = p[k] ?? def;
  const v = typeof raw === 'string' ? (/^-?inf(inity)?$/i.test(raw.trim()) ? (raw.trim().startsWith('-') ? -Infinity : Infinity) : Number(raw)) : raw;
  if (typeof v !== 'number' || Number.isNaN(v)) throw new ApiError(400, `Parameter "${k}" must be a number`);
  return v;
};
const arr = (p: Params, k: string): number[] => {
  let v = p[k];
  if (typeof v === 'string') v = v.split(/[,\s]+/).filter(Boolean).map(Number);
  if (!Array.isArray(v)) throw new ApiError(400, `Parameter "${k}" must be an array of numbers`);
  if (v.length > MAX_ARRAY) throw new ApiError(413, `Parameter "${k}" has too many items (max ${MAX_ARRAY})`);
  return v.map(Number);
};
/** A required expression parameter, validated against safe-mode rules. */
const expr = (p: Params, k: string, def?: string): string => {
  const v = str(p, k, def);
  try {
    validateUntrusted(v, prepare);
  } catch (e) {
    throw new ApiError(400, (e as Error).message.replace(/\s*\(char \d+\)$/, ''));
  }
  return v;
};
const angleOf = (p: Params) => (p.angle === 'deg' || p.angle === 'grad' ? p.angle : 'rad') as 'rad' | 'deg' | 'grad';

function calculator(p: Params) {
  const digits = p.digits !== undefined ? Math.max(1, Math.min(64, num(p, 'digits'))) : 14;
  const big = p.bignumber === true || p.bignumber === 'true' || p.precision !== undefined;
  return new Calculator({
    safe: true,
    angle: angleOf(p),
    notation: ['auto', 'fix', 'sci', 'eng'].includes(p.notation) ? p.notation : 'auto',
    digits,
    grouping: p.grouping === true || p.grouping === 'true',
    bignumber: big,
    precision: big ? Math.max(16, Math.min(128, Number(p.precision ?? 64))) : 64,
  });
}

function evalOne(c: Calculator, expr: string) {
  if (expr.length > MAX_EXPR) throw new ApiError(413, 'Expression too long');
  const r = c.evaluate(expr);
  return {
    expr,
    ok: r.ok,
    result: r.ok ? r.text : undefined,
    tex: r.ok ? r.tex : undefined,
    exact: r.exact ? { text: r.exact.text, tex: r.exact.tex } : undefined,
    kind: r.kind,
    value: r.ok && typeof r.value === 'number' && Number.isFinite(r.value) ? r.value : undefined,
    error: r.error,
  };
}

export interface ApiResult {
  status?: number;
  body: unknown;
  contentType?: string;
  cache?: string;
}

export function handle(action: string, p: Params): ApiResult {
  switch (action) {
    case '':
    case 'index':
      return { body: { name: 'Calci API', version: VERSION, docs: '/developers', openapi: '/api/v1/openapi', endpoints: Object.keys(openapi.paths) } };
    case 'openapi':
      return { body: openapi };
    case 'functions':
      return { body: { functions: FN_DOCS } };
    case 'evaluate': {
      const c = calculator(p);
      if (p.scope && typeof p.scope === 'object') {
        for (const [k, v] of Object.entries(p.scope).slice(0, 100)) if (/^[A-Za-z_]\w{0,30}$/.test(k) && typeof v === 'number') c.setVariable(k, v);
      }
      let list: string[] | null = null;
      if (Array.isArray(p.expressions)) list = p.expressions.map(String);
      else if (Array.isArray(p.expr)) list = p.expr.map(String);
      if (list) {
        if (list.length > 50) throw new ApiError(413, 'Too many expressions (max 50)');
        return { body: { results: list.map((e) => evalOne(c, e)) } };
      }
      return { body: evalOne(c, str(p, 'expr')) };
    }
    case 'simplify': {
      const r = calculus.simplify(expr(p, 'expr'));
      return { body: { result: r.text, tex: r.tex } };
    }
    case 'derivative': {
      const v = typeof p.variable === 'string' && /^[A-Za-z_]\w*$/.test(p.variable) ? p.variable : 'x';
      const order = Math.max(1, Math.min(6, Math.round(num(p, 'order', 1))));
      const e = expr(p, 'expr');
      const r = calculus.differentiate(e, v, order);
      const body: Record<string, unknown> = { result: r.text, tex: r.tex, variable: v, order };
      if (p.at !== undefined) body.valueAt = { at: num(p, 'at'), value: calculus.derivativeAt(e, num(p, 'at'), v, order) };
      return { body };
    }
    case 'integral': {
      const v = typeof p.variable === 'string' && /^[A-Za-z_]\w*$/.test(p.variable) ? p.variable : 'x';
      const r = calculus.definiteIntegral(expr(p, 'expr'), num(p, 'a'), num(p, 'b'), v, angleOf(p));
      return { body: { value: r.value, errorEstimate: r.error, evaluations: r.evaluations } };
    }
    case 'limit': {
      const v = typeof p.variable === 'string' && /^[A-Za-z_]\w*$/.test(p.variable) ? p.variable : 'x';
      const side = p.side === 'left' || p.side === 'right' ? p.side : 'both';
      const r = calculus.limitOf(expr(p, 'expr'), num(p, 'at'), v, side);
      return { body: { value: r.exists ? r.value : null, exists: r.exists, left: r.left, right: r.right } };
    }
    case 'taylor': {
      const v = typeof p.variable === 'string' && /^[A-Za-z_]\w*$/.test(p.variable) ? p.variable : 'x';
      const r = calculus.taylor(expr(p, 'expr'), v, num(p, 'at', 0), Math.max(1, Math.min(12, Math.round(num(p, 'order', 5)))));
      return { body: r };
    }
    case 'solve': {
      const type = p.type ?? (p.coefficients ? 'polynomial' : p.A ? 'linear' : 'equation');
      if (type === 'polynomial') {
        const c = arr(p, 'coefficients');
        if (c.length > 51) throw new ApiError(413, 'Polynomial degree too high (max 50)');
        return { body: { roots: solver.polyRoots(c) } };
      }
      if (type === 'linear') {
        if (!Array.isArray(p.A) || !Array.isArray(p.b)) throw new ApiError(400, 'Linear systems need A (matrix) and b (vector)');
        if (p.A.length > 100) throw new ApiError(413, 'System too large (max 100 equations)');
        return { body: solver.solveLinear(p.A.map((r: unknown[]) => r.map(Number)), p.b.map(Number)) };
      }
      const eq = expr(p, 'equation', p.expr);
      const [lhs, rhs = '0'] = eq.split(/(?<![<>!=])=(?!=)/);
      const v = typeof p.variable === 'string' && /^[A-Za-z_]\w*$/.test(p.variable) ? p.variable : 'x';
      const f = calculus.fn1(`(${lhs}) - (${rhs})`, v, angleOf(p));
      const lo = num(p, 'min', -100);
      const hi = num(p, 'max', 100);
      if (!(hi > lo) || hi - lo > 1e9) throw new ApiError(400, 'Invalid search range');
      return { body: { variable: v, solutions: solver.solveEquation(f, lo, hi) } };
    }
    case 'stats': {
      const x = arr(p, 'data');
      const body: Record<string, unknown> = { summary: stats.describe(x, p.frequencies ? arr(p, 'frequencies') : undefined) };
      if (p.y !== undefined) {
        const y = arr(p, 'y');
        const model = (p.model ?? 'linear') as RegressionModel;
        if (!stats.REGRESSION_MODELS.some((m) => m.id === model)) throw new ApiError(400, `Unknown model "${model}"`);
        const r = stats.regress(x, y, model);
        body.regression = { model: r.model, params: r.params, r2: r.r2, r: r.r, equation: r.equation, expression: r.expression };
      }
      return { body };
    }
    case 'distribution': {
      const d = distributions.DISTRIBUTIONS.find((x) => x.id === (p.dist ?? p.distribution ?? 'normal'));
      if (!d) throw new ApiError(400, `Unknown distribution. Use one of: ${distributions.DISTRIBUTIONS.map((x) => x.id).join(', ')}`);
      const params = d.params.map((q) => (p[q.key] !== undefined ? num(p, q.key) : q.default));
      const body: Record<string, unknown> = { distribution: d.id, params: Object.fromEntries(d.params.map((q, i) => [q.key, params[i]])), mean: d.mean(params), variance: d.variance(params) };
      if (p.x !== undefined) body.pdf = d.pdf(num(p, 'x'), params);
      if (p.x !== undefined) body.cdf = d.cdf(num(p, 'x'), params);
      if (p.a !== undefined || p.b !== undefined) {
        const a = p.a !== undefined ? num(p, 'a') : -Infinity;
        const b = p.b !== undefined ? num(p, 'b') : Infinity;
        const cdf = (v: number) => (v === Infinity ? 1 : v === -Infinity ? 0 : d.cdf(v, params));
        body.probability = d.discrete ? cdf(Math.floor(b)) - (Number.isFinite(a) ? cdf(Math.ceil(a) - 1) : 0) : cdf(b) - cdf(a);
      }
      if (p.p !== undefined && d.inv) body.quantile = d.inv(num(p, 'p'), params);
      return { body };
    }
    case 'convert': {
      if (typeof p.query === 'string') return { body: units.convertQuery(str(p, 'query')) };
      const value = num(p, 'value');
      const from = str(p, 'from');
      const to = str(p, 'to');
      return { body: { value: units.convertUnit(value, from, to), from, to, input: value } };
    }
    case 'units':
      return { body: { categories: units.UNIT_CATEGORIES.map((c) => ({ id: c.id, label: c.label, units: c.units })) } };
    case 'programmer': {
      const base = [2, 8, 10, 16].includes(Number(p.base)) ? (Number(p.base) as 2 | 8 | 10 | 16) : 10;
      const word = [8, 16, 32, 64, 128].includes(Number(p.word)) ? (Number(p.word) as 8 | 16 | 32 | 64 | 128) : 64;
      const signed = !(p.signed === false || p.signed === 'false');
      const v = programmer.progEvaluate(str(p, 'expr'), { base, word, signed });
      return { body: { dec: programmer.toBase(v, 10, word), hex: programmer.toBase(v, 16, word), oct: programmer.toBase(v, 8, word), bin: programmer.toBase(v, 2, word), word, signed } };
    }
    case 'finance': {
      const op = p.op ?? 'tvm';
      if (op === 'tvm' || op === 'amortization') {
        const tvm: TvmInput = { ...finance.DEFAULT_TVM, pmt: 0 };
        for (const k of ['n', 'iy', 'pv', 'pmt', 'fv', 'py', 'cy'] as const) if (p[k] !== undefined) tvm[k] = num(p, k);
        tvm.begin = p.begin === true || p.begin === 'true';
        if (op === 'amortization') {
          if (tvm.n > 1200) throw new ApiError(413, 'Schedule too long (max 1200 periods)');
          if (!p.pmt) tvm.pmt = finance.solveTvm(tvm, 'pmt');
          return { body: { payment: tvm.pmt, schedule: finance.amortization(tvm) } };
        }
        const solveFor = (p.solve ?? 'pmt') as TvmKey;
        if (!['n', 'iy', 'pv', 'pmt', 'fv'].includes(solveFor)) throw new ApiError(400, 'solve must be one of n, iy, pv, pmt, fv');
        return { body: { solve: solveFor, value: finance.solveTvm(tvm, solveFor) } };
      }
      if (op === 'npv') return { body: { npv: finance.npv(num(p, 'rate'), arr(p, 'cashflows')) } };
      if (op === 'irr') return { body: { irr: finance.irr(arr(p, 'cashflows')) } };
      if (op === 'loan') return { body: finance.loanPayment(num(p, 'principal'), num(p, 'rate'), num(p, 'months')) };
      throw new ApiError(400, 'op must be one of tvm, amortization, npv, irr, loan');
    }
    case 'plot': {
      let exprs: string[] = [];
      if (Array.isArray(p.expr)) exprs = p.expr.map(String);
      else if (typeof p.expr === 'string') exprs = [p.expr];
      if (Array.isArray(p.expressions)) exprs = p.expressions.map(String);
      else if (typeof p.expressions === 'string') {
        try {
          exprs = JSON.parse(p.expressions);
        } catch {
          exprs = [p.expressions];
        }
      }
      if (!exprs.length) throw new ApiError(400, 'Provide at least one expr');
      if (exprs.length > 20 || exprs.some((e) => e.length > MAX_EXPR)) throw new ApiError(413, 'Too many or too long expressions');
      const o = (k: string) => (p[k] !== undefined ? num(p, k) : undefined);
      // nested sums/integrals in plotted curves share a hard work budget
      setWorkBudget(20_000_000);
      let svg: string;
      try {
        svg = graph.renderSvg(exprs, {
          width: o('width'),
          height: o('height'),
          xmin: o('xmin'),
          xmax: o('xmax'),
          ymin: o('ymin'),
          ymax: o('ymax'),
          theme: p.theme === 'dark' ? 'dark' : 'light',
          grid: p.grid !== 'false',
          axes: p.axes !== 'false',
          angle: angleOf(p),
        });
      } finally {
        setWorkBudget(Infinity);
      }
      return { body: svg, contentType: 'image/svg+xml; charset=utf-8', cache: 'public, max-age=86400, s-maxage=604800, immutable' };
    }
    default:
      throw new ApiError(404, `Unknown endpoint "${action}". See /api/v1/openapi`);
  }
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

/** Parse query + JSON body into params (body wins). */
export async function paramsFromRequest(req: Request): Promise<Params> {
  const url = new URL(req.url);
  const params: Params = {};
  for (const k of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(k);
    params[k] = all.length > 1 ? all : all[0];
  }
  if (req.method === 'POST') {
    const text = await req.text();
    if (text.length > 256 * 1024) throw new ApiError(413, 'Request body too large');
    if (text.trim()) {
      try {
        Object.assign(params, JSON.parse(text));
      } catch {
        throw new ApiError(400, 'Body must be valid JSON');
      }
    }
  }
  return params;
}

/** Full request → response cycle using web-standard Request/Response. */
export async function respond(req: Request, action: string): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const params = await paramsFromRequest(req);
    const r = handle(action, params);
    if (typeof r.body === 'string')
      return new Response(r.body, { status: r.status ?? 200, headers: { ...CORS_HEADERS, 'Content-Type': r.contentType ?? 'text/plain', 'Cache-Control': r.cache ?? 'no-store' } });
    return json(r.body, r.status ?? 200, r.cache);
  } catch (e) {
    if (e instanceof ApiError) return json({ error: e.message }, e.status);
    return json({ error: (e as Error).message?.replace(/\s*\(char \d+\)$/, '') || 'Bad request' }, 400);
  }
}

function json(body: unknown, status = 200, cache?: string): Response {
  return new Response(JSON.stringify(body, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? (Number.isNaN(v) ? null : v > 0 ? 'Infinity' : '-Infinity') : v)), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache ?? 'no-store' },
  });
}
