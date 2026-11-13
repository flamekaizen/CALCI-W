/**
 * Calci core: a framework-free maths engine.
 *
 *   import { Calculator, evaluate, graph, solver, stats } from '@calci/core';
 *
 * Everything here runs in browsers, Node, workers and edge runtimes.
 */
export { Calculator, evaluate, prepare, friendlyError, DEFAULT_SETTINGS } from './engine.js';
export type { CalculatorSettings, EvalResult, Variable, ResultKind } from './engine.js';
export { createMath, assertSafe, toNumber, UNSAFE_FUNCTIONS } from './math.js';
export type { CalciMath, MathConfig, AngleUnit } from './math.js';
export { formatNumber, formatValue, exactForm, toFraction, expressionTex } from './format.js';
export type { FormatOptions, Notation, Formatted, ExactForm } from './format.js';
export { normalizeInput, extractBraces } from './normalize.js';
export { compileNode, CompileError } from './compile.js';

export * as numerics from './numerics.js';
export * as programmer from './programmer.js';
export * as solver from './solver.js';
export * as calculus from './calculus.js';
export * as stats from './stats.js';
export * as distributions from './distributions.js';
export * as finance from './finance.js';
export * as units from './units.js';

import * as parse from './graph/parse.js';
import * as sample from './graph/sample.js';
import * as analysis from './graph/analysis.js';
import * as ticks from './graph/ticks.js';
import * as palette from './graph/palette.js';
import { renderSvg } from './graph/svg.js';
export const graph = { ...parse, ...sample, ...analysis, ...ticks, ...palette, renderSvg };
export type { GraphLine, CompiledItem, CompiledGraph, GraphKind } from './graph/parse.js';
export type { Viewport, Polyline } from './graph/sample.js';

export const VERSION = '1.0.0';
