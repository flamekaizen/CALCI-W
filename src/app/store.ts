import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import type { AngleUnit, Notation } from '../core/index';
import { CURVE_COLORS_LIGHT } from '../core/graph/palette';

export type Theme = 'light' | 'dark' | 'system';
export type Accent = 'indigo' | 'teal' | 'rose' | 'amber' | 'emerald' | 'sky';

export interface HistoryEntry {
  id: string;
  input: string;
  result: string;
  tex?: string;
  inputTex?: string;
  time: number;
  error?: boolean;
  /** Textbook-editor LaTeX of the input, for re-editing. */
  latex?: string;
}

export interface Slider {
  min: number;
  max: number;
  step: number;
}

export interface GraphExpr {
  id: string;
  text: string;
  color: string;
  hidden?: boolean;
  style?: 'solid' | 'dashed' | 'dotted';
  width?: number;
  fillOpacity?: number;
  slider?: Slider;
  range?: [number, number];
  note?: boolean;
}

export interface GraphView {
  cx: number;
  cy: number;
  /** Visible width in world units. */
  xspan: number;
  /** Visible height in world units; null = square units. */
  yspan: number | null;
}

export interface GraphSettings {
  grid: boolean;
  minor: boolean;
  axes: boolean;
  labels: boolean;
  piX: boolean;
  polarGrid: boolean;
  angle: AngleUnit;
  poi: boolean;
}

export interface Surface {
  id: string;
  text: string;
  color: string;
  hidden?: boolean;
}

export interface Script {
  id: string;
  name: string;
  lang: 'js' | 'python';
  code: string;
}

export interface CalcPrefs {
  angle: AngleUnit;
  notation: Notation;
  digits: number;
  grouping: boolean;
  bignumber: boolean;
  precision: number;
}

export interface AppState {
  theme: Theme;
  accent: Accent;
  navCollapsed: boolean;
  calc: CalcPrefs;
  exactDefault: boolean;
  /** Textbook (natural display) or linear one-line input. */
  inputStyle: 'textbook' | 'linear';
  /** Has the user seen the welcome tour. */
  onboarded: boolean;
  haptics: boolean;
  history: HistoryEntry[];
  library: string;
  scripts: Script[];
  graph: { exprs: GraphExpr[]; view: GraphView; settings: GraphSettings };
  graph3d: { surfaces: Surface[]; range: number; resolution: number; wireframe: boolean };
  recentModes: string[];

  set: (partial: Partial<AppState>) => void;
  setCalc: (partial: Partial<CalcPrefs>) => void;
  addHistory: (e: Omit<HistoryEntry, 'id' | 'time'>) => void;
  clearHistory: () => void;
  removeHistory: (id: string) => void;
  setGraph: (partial: Partial<AppState['graph']>) => void;
  updateExpr: (id: string, patch: Partial<GraphExpr>) => void;
  addExpr: (text?: string, after?: string) => string;
  removeExpr: (id: string) => void;
  setGraphSettings: (partial: Partial<GraphSettings>) => void;
  setView: (v: GraphView) => void;
  set3d: (partial: Partial<AppState['graph3d']>) => void;
  touchMode: (mode: string) => void;
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export const DEFAULT_VIEW: GraphView = { cx: 0, cy: 0, xspan: 20, yspan: null };

export function nextColor(exprs: { color: string }[]): string {
  const used = exprs.map((e) => e.color);
  return CURVE_COLORS_LIGHT.find((c) => !used.includes(c)) ?? CURVE_COLORS_LIGHT[exprs.length % CURVE_COLORS_LIGHT.length];
}

const DEFAULT_EXPRS: GraphExpr[] = [
  { id: 'e1', text: 'y = sin(x)', color: CURVE_COLORS_LIGHT[0] },
  { id: 'e2', text: 'y = a x^2 - 3', color: CURVE_COLORS_LIGHT[1] },
  { id: 'e3', text: 'a = 0.5', color: CURVE_COLORS_LIGHT[2], slider: { min: -2, max: 2, step: 0.05 } },
  { id: 'e4', text: '', color: CURVE_COLORS_LIGHT[3] },
];

const DEFAULT_LIBRARY = `# Your function library — available in every mode (calculator, graphing, calculus…)
# One definition per line. Lines starting with # are comments.
hyp(a, b) = sqrt(a^2 + b^2)
compound(p, r, n) = p * (1 + r/100)^n
g0 = 9.80665
`;

const DEFAULT_SCRIPTS: Script[] = [
  {
    id: 's1',
    name: 'Primes & sequences',
    lang: 'js',
    code: `// Scripts run in a sandboxed worker. \`math\` is the Calci engine (math.js),
// print() writes to the console, table() renders rows, plot() draws a function.
const primes = [];
for (let n = 2; primes.length < 20; n++) if (math.isPrime(n)) primes.push(n);
print('First 20 primes:', primes.join(', '));

const fib = [0, 1];
while (fib.length < 15) fib.push(fib.at(-1) + fib.at(-2));
table(fib.map((f, i) => ({ n: i, 'F(n)': f, ratio: i > 1 ? (f / fib[i - 1]).toFixed(6) : '' })));

plot('x -> sin(x) * exp(-x / 6)', -2, 20);
`,
  },
  {
    id: 's2',
    name: "Newton's method",
    lang: 'js',
    code: `// Find a root of f with Newton's method and show each iteration.
const f = math.compile('x^3 - 2x - 5');
const df = math.derivative('x^3 - 2x - 5', 'x').compile();
let x = 2;
const rows = [];
for (let i = 0; i < 8; i++) {
  const fx = f.evaluate({ x });
  rows.push({ i, x: x.toPrecision(15), 'f(x)': fx.toExponential(3) });
  x = x - fx / df.evaluate({ x });
}
table(rows);
print('Root ≈', x);
`,
  },
  {
    id: 's3',
    name: 'Monte Carlo π (Python)',
    lang: 'python',
    code: `# Python runs in your browser (first run downloads the runtime, ~10 MB).
import random, math
inside = 0
N = 200_000
for _ in range(N):
    x, y = random.random(), random.random()
    if x*x + y*y <= 1:
        inside += 1
est = 4 * inside / N
print(f"π ≈ {est:.5f}  (error {abs(est - math.pi):.2e})")
`,
  },
];

/** localStorage wrapper that never throws (private mode, quotas, sandboxed iframes). */
const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

/** No-op storage for embeds. */
const sessionStorageSafe: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

/** Embedded instances must not share or overwrite the main app's saved state. */
const isEmbed = typeof location !== 'undefined' && location.pathname.startsWith('/embed');

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      accent: 'indigo',
      navCollapsed: false,
      calc: { angle: 'deg', notation: 'auto', digits: 12, grouping: true, bignumber: false, precision: 64 },
      exactDefault: true,
      inputStyle: 'textbook',
      onboarded: false,
      haptics: true,
      history: [],
      library: DEFAULT_LIBRARY,
      scripts: DEFAULT_SCRIPTS,
      graph: {
        exprs: DEFAULT_EXPRS,
        view: DEFAULT_VIEW,
        settings: { grid: true, minor: true, axes: true, labels: true, piX: false, polarGrid: false, angle: 'rad', poi: true },
      },
      graph3d: {
        surfaces: [
          { id: 'z1', text: 'z = sin(x) * cos(y)', color: CURVE_COLORS_LIGHT[0] },
          { id: 'z2', text: '', color: CURVE_COLORS_LIGHT[1] },
        ],
        range: 5,
        resolution: 48,
        wireframe: true,
      },
      recentModes: [],

      set: (partial) => set(partial),
      setCalc: (partial) => set({ calc: { ...get().calc, ...partial } }),
      addHistory: (e) => set({ history: [{ ...e, id: uid(), time: Date.now() }, ...get().history].slice(0, 500) }),
      clearHistory: () => set({ history: [] }),
      removeHistory: (id) => set({ history: get().history.filter((h) => h.id !== id) }),
      setGraph: (partial) => set({ graph: { ...get().graph, ...partial } }),
      updateExpr: (id, patch) => set({ graph: { ...get().graph, exprs: get().graph.exprs.map((e) => (e.id === id ? { ...e, ...patch } : e)) } }),
      addExpr: (text = '', after) => {
        const g = get().graph;
        const e: GraphExpr = { id: uid(), text, color: nextColor(g.exprs) };
        const idx = after ? g.exprs.findIndex((x) => x.id === after) : -1;
        const exprs = g.exprs.slice();
        if (idx >= 0) exprs.splice(idx + 1, 0, e);
        else exprs.push(e);
        set({ graph: { ...g, exprs } });
        return e.id;
      },
      removeExpr: (id) => {
        const g = get().graph;
        const exprs = g.exprs.filter((e) => e.id !== id);
        set({ graph: { ...g, exprs: exprs.length ? exprs : [{ id: uid(), text: '', color: CURVE_COLORS_LIGHT[0] }] } });
      },
      setGraphSettings: (partial) => set({ graph: { ...get().graph, settings: { ...get().graph.settings, ...partial } } }),
      setView: (view) => set({ graph: { ...get().graph, view } }),
      set3d: (partial) => set({ graph3d: { ...get().graph3d, ...partial } }),
      touchMode: (mode) => set({ recentModes: [mode, ...get().recentModes.filter((m) => m !== mode)].slice(0, 6) }),
    }),
    {
      name: isEmbed ? 'calci-embed-v1' : 'calci-state-v1',
      version: 1,
      storage: createJSONStorage(() => (isEmbed ? sessionStorageSafe : safeStorage)),
      partialize: (s) => ({
        theme: s.theme,
        accent: s.accent,
        navCollapsed: s.navCollapsed,
        calc: s.calc,
        exactDefault: s.exactDefault,
        inputStyle: s.inputStyle,
        onboarded: s.onboarded,
        haptics: s.haptics,
        history: s.history,
        library: s.library,
        scripts: s.scripts,
        graph: s.graph,
        graph3d: s.graph3d,
        recentModes: s.recentModes,
      }),
    },
  ),
);

