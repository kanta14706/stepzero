import { describe, expect, it } from 'vitest';
import { findRoute, indexGraph } from '../routing/astar';
import { routeToSteps } from '../routing/steps';
import { stepBounds, routeFeatures } from './routeGeojson';
import type { PlannedRoute } from './routeGeojson';
import { testGraph } from './mapFixtures';

/** The fixture route for a profile that may use stairs: walk, escalator to B1, stairs to B2. */
function planned(): { graph: ReturnType<typeof testGraph>; route: PlannedRoute } {
  const graph = testGraph();
  const index = indexGraph(graph);
  const found = findRoute(index, { from: 'a1', to: 'p1', profile: 'sensory' });
  if (!found.ok) throw new Error('no route');
  return {
    graph,
    route: { nodes: found.nodes, legs: found.legs, steps: routeToSteps(index, found) },
  };
}

describe('routeFeatures', () => {
  const { graph, route } = planned();
  const fc = routeFeatures(graph, route);
  const lines = fc.features.filter((f) => f.properties?.['kind'] === 'line');
  const starts = fc.features.filter((f) => f.properties?.['kind'] === 'start');
  const ends = fc.features.filter((f) => f.properties?.['kind'] === 'end');

  it('draws a line only for legs whose ends are on the same floor', () => {
    // 4 nodes, 3 legs: only the first (walk on the ground) stays on one floor.
    expect(route.legs).toHaveLength(3);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.geometry.type).toBe('LineString');
    expect(lines[0]?.properties).toMatchObject({ panel: 0, step: 1 });
  });

  it('numbers one marker per step, matching the position in the step list', () => {
    expect(starts).toHaveLength(route.steps.length);
    starts.forEach((f, i) => {
      expect(f.properties).toMatchObject({ step: i, label: String(i + 1) });
    });
  });

  it('adds a hollow end marker where a lift or flight arrives on another floor', () => {
    // escalator ground to B1, stairs B1 to B2
    expect(ends.map((f) => f.properties)).toMatchObject([
      { step: 2, panel: -1 },
      { step: 3, panel: -2 },
    ]);
  });

  it('tags every line with the step it belongs to', () => {
    for (const f of lines) {
      const step = route.steps[f.properties?.['step'] as number];
      expect(step?.kind).toBeDefined();
    }
  });
});

describe('stepBounds', () => {
  const { graph, route } = planned();
  const fc = routeFeatures(graph, route);

  it('wraps the features of one step on one floor', () => {
    const i = route.steps.findIndex((s) => s.kind === 'walk');
    const b = stepBounds(fc, i, 0);
    expect(b).not.toBeNull();
    const [w, s, e, n] = b as [number, number, number, number];
    expect(w).toBeLessThanOrEqual(e);
    expect(s).toBeLessThanOrEqual(n);
  });

  it('finds the arrival point of a flight on the floor it ends on', () => {
    const i = route.steps.findIndex((s) => s.kind === 'stairs');
    expect(stepBounds(fc, i, -2)).not.toBeNull(); // the hollow end marker
    expect(stepBounds(fc, i, -1)).not.toBeNull(); // the numbered start marker
  });

  it('is null when the step has nothing on that floor', () => {
    expect(stepBounds(fc, 0, 99)).toBeNull();
    expect(stepBounds(fc, 999, 0)).toBeNull();
  });
});
