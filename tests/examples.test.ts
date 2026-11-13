import { describe, it, expect } from 'vitest';
import { GRAPH_EXAMPLES } from '../src/app/modes/graph/examples';
import { graph } from '../src/core/index';

describe('graph example gallery', () => {
  for (const cat of GRAPH_EXAMPLES) {
    for (const ex of cat.items) {
      it(`${cat.id}: ${ex.title}`, () => {
        const lines = ex.exprs.map((e, i) => ({ id: String(i), text: typeof e === 'string' ? e : e.text, range: typeof e === 'string' ? undefined : e.range }));
        const g = graph.compileGraph(lines);
        const bad = g.items.map((it, i) => [lines[i].text, it.kind, it.error]).filter(([, k]) => k === 'error' || k === 'empty');
        expect(bad).toEqual([]);
        const svg = graph.renderSvg(lines.map((l) => l.text), { width: 200, height: 120 });
        expect(svg.length).toBeGreaterThan(200);
      });
    }
  }
});
