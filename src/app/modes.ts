import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import {
  Calculator, ChartSpline, Box, Binary, Grid3x3, Equal, SquareFunction, ChartColumn, Landmark, Ruler, CodeXml, Plug, Table2, Sheet, BookOpen,
  type LucideIcon,
} from 'lucide-react';

export interface ModeDef {
  id: string;
  label: string;
  short: string;
  description: string;
  icon: LucideIcon;
  keywords: string;
  group: 'Calculate' | 'Visualise' | 'Tools' | 'Build' | 'Help';
  /** Full-bleed layout (no page padding / scrolling). */
  fill?: boolean;
  component: LazyExoticComponent<ComponentType>;
}

export const MODES: ModeDef[] = [
  {
    id: 'guide', label: 'Guide & Examples', short: 'Guide', icon: BookOpen, group: 'Help',
    description: 'Everything Calci can do, what you can plot, and every function',
    keywords: 'help guide examples tutorial what can plot functions reference how to casio ti desmos',
    component: lazy(() => import('./modes/Guide')),
  },
  {
    id: 'scientific', label: 'Scientific', short: 'Calc', icon: Calculator, group: 'Calculate',
    description: 'Natural-display scientific calculator with history, variables and exact answers',
    keywords: 'basic arithmetic trig log exponent fraction memory ans complex',
    component: lazy(() => import('./modes/Scientific')),
  },
  {
    id: 'graph', label: 'Graphing', short: 'Graph', icon: ChartSpline, group: 'Visualise', fill: true,
    description: 'Plot functions, implicit curves, polar, parametric, inequalities and sliders',
    keywords: 'plot graph function curve slider polar parametric inequality implicit desmos',
    component: lazy(() => import('./modes/graph/GraphMode')),
  },
  {
    id: '3d', label: '3D Surfaces', short: '3D', icon: Box, group: 'Visualise', fill: true,
    description: 'Rotate and explore surfaces z = f(x, y)',
    keywords: '3d surface plot z rotate',
    component: lazy(() => import('./modes/Graph3D')),
  },
  {
    id: 'programmer', label: 'Programmer', short: 'Prog', icon: Binary, group: 'Calculate',
    description: 'Hex, decimal, octal and binary with bitwise logic and IEEE-754 inspection',
    keywords: 'hex binary octal bitwise and or xor shift two complement ieee float ascii',
    component: lazy(() => import('./modes/Programmer')),
  },
  {
    id: 'matrix', label: 'Matrix', short: 'Matrix', icon: Grid3x3, group: 'Calculate',
    description: 'Matrix and vector algebra: determinant, inverse, RREF, eigenvalues, decompositions',
    keywords: 'matrix vector determinant inverse eigen rref rank lu qr transpose linear algebra',
    component: lazy(() => import('./modes/Matrix')),
  },
  {
    id: 'solver', label: 'Equation Solver', short: 'Solve', icon: Equal, group: 'Calculate',
    description: 'Polynomials, simultaneous linear systems and any equation f(x) = g(x)',
    keywords: 'solve equation polynomial quadratic cubic roots linear system simultaneous',
    component: lazy(() => import('./modes/Solver')),
  },
  {
    id: 'calculus', label: 'Calculus', short: 'Calculus', icon: SquareFunction, group: 'Calculate',
    description: 'Derivatives, integrals, limits, series and Taylor polynomials',
    keywords: 'derivative integral limit series taylor sum product tangent differentiate integrate',
    component: lazy(() => import('./modes/Calculus')),
  },
  {
    id: 'stats', label: 'Statistics', short: 'Stats', icon: ChartColumn, group: 'Visualise',
    description: 'Data analysis, regression, probability distributions and hypothesis tests',
    keywords: 'statistics mean median standard deviation regression distribution normal binomial t-test confidence',
    component: lazy(() => import('./modes/Statistics')),
  },
  {
    id: 'table', label: 'Table & Sequences', short: 'Table', icon: Table2, group: 'Visualise',
    description: 'Value tables for f(x), g(x), h(x) and explicit or recursive sequences',
    keywords: 'table values sequence recursive arithmetic geometric series fibonacci u(n) casio table',
    component: lazy(() => import('./modes/Table')),
  },
  {
    id: 'sheet', label: 'Spreadsheet', short: 'Sheet', icon: Sheet, group: 'Tools',
    description: 'Cells with formulas, ranges, fill down and CSV import / export',
    keywords: 'spreadsheet cells formula sum average csv excel grid',
    component: lazy(() => import('./modes/Spreadsheet')),
  },
  {
    id: 'finance', label: 'Finance', short: 'Finance', icon: Landmark, group: 'Tools',
    description: 'Time value of money, loans, amortisation, NPV / IRR and depreciation',
    keywords: 'finance tvm loan mortgage emi interest npv irr amortization depreciation investment',
    component: lazy(() => import('./modes/Finance')),
  },
  {
    id: 'units', label: 'Converter', short: 'Units', icon: Ruler, group: 'Tools',
    description: 'Convert units across 18 categories, plus date calculations',
    keywords: 'unit convert length mass temperature volume speed data currency date',
    component: lazy(() => import('./modes/Units')),
  },
  {
    id: 'code', label: 'Code & Library', short: 'Code', icon: CodeXml, group: 'Build',
    description: 'Write JavaScript or Python programs and define your own functions',
    keywords: 'code script program javascript python custom function library',
    component: lazy(() => import('./modes/Code')),
  },
  {
    id: 'developers', label: 'API & Embed', short: 'API', icon: Plug, group: 'Build',
    description: 'REST API, JavaScript SDK and embeddable widgets for your own apps',
    keywords: 'api embed sdk widget integrate developer rest iframe web component',
    component: lazy(() => import('./modes/Developers')),
  },
];

export const MODE_GROUPS: ModeDef['group'][] = ['Help', 'Calculate', 'Visualise', 'Tools', 'Build'];

export const findMode = (id: string) => MODES.find((m) => m.id === id);
