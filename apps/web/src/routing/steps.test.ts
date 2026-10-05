import { describe, expect, it } from 'vitest';
import { findRoute, indexGraph } from './astar';
import { edge, graph, node, twoRouteGraph } from './fixtures';
import { expectCoversLegs } from './expect-steps';
import { classifyTurn, routeToSteps } from './steps';
import type { Step } from './steps';
import type { GraphEdge, GraphNode, NodeKind, ProfileId, RouteResult, StationGraph } from './types';

/** A node `x` metres east and `y` metres north of a fixed point. */
function at(id: string, kind: NodeKind, level: number, x: number, y: number): GraphNode {
  return node(
    id,
    kind,
    level,
    139 + x / (111320 * Math.cos((35 * Math.PI) / 180)),
    35 + y / 110540,
  );
}

function stepsFor(
  g: StationGraph,
  from: string,
  to: string,
  profile: ProfileId = 'wheelchair',
): { steps: Step[]; route: Extract<RouteResult, { ok: true }> } {
  const index = indexGraph(g);
  const route = findRoute(index, { from, to, profile });
  if (!route.ok) throw new Error(`no route: ${JSON.stringify(route.failure)}`);
  const steps = routeToSteps(index, route);
  expectCoversLegs(steps, route.legs.length);
  return { steps, route };
}

/** An edge whose slope bucket is unknown in the data. */
function withoutSlope(e: GraphEdge): GraphEdge {
  const copy = { ...e };
  delete copy.slopePct;
  return copy;
}

const kinds = (steps: Step[]) => steps.map((s) => s.kind);
const walks = (steps: Step[]) =>
  steps.filter((s): s is Extract<Step, { kind: 'walk' }> => s.kind === 'walk');

describe('classifyTurn', () => {
  it.each([
    [0, 'straight'],
    [29, 'straight'],
    [-29, 'straight'],
    [45, 'slight_right'],
    [-45, 'slight_left'],
    [90, 'right'],
    [-90, 'left'],
    [140, 'right'],
    [160, 'u_turn'],
    [-180, 'u_turn'],
  ] as const)('%d degrees is %s', (deg, turn) => {
    expect(classifyTurn(deg)).toBe(turn);
  });
});

describe('routeToSteps', () => {
  it('turns left and right relative to the direction faced after a fare gate', () => {
    // Through the gate heading north, 20 m north, 20 m east (right), 20 m north (left).
    const g = graph(
      [
        at('g1', 'gate', -1, 0, 0),
        at('g2', 'gate', -1, 0, 3),
        at('a', 'junction', -1, 0, 23),
        at('b', 'junction', -1, 20, 23),
        at('p', 'platform', -1, 20, 43),
      ],
      [
        edge('gate', 'g1', 'g2', 'fare_gate'),
        edge('w1', 'g2', 'a', 'walk'),
        edge('w2', 'a', 'b', 'walk'),
        edge('w3', 'b', 'p', 'walk'),
      ],
    );
    const { steps } = stepsFor(g, 'g1', 'p');
    expect(kinds(steps)).toEqual(['start', 'fare_gate', 'walk', 'walk', 'walk', 'arrive']);
    expect(steps[1]).toMatchObject({ kind: 'fare_gate', direction: 'in' });
    expect(walks(steps).map((w) => w.turn)).toEqual(['straight', 'right', 'left']);
    expect(walks(steps).map((w) => w.target)).toEqual([null, null, 'platform']);
    expect(walks(steps)[1]?.lengthM).toBeCloseTo(10, 0); // fixture edges are 10 m long
  });

  it('has no turn for the first walk from an entrance (the heading is unknown)', () => {
    const g = graph(
      [at('e', 'entrance', 0, 0, 0), at('a', 'junction', 0, 0, 20), at('b', 'gate', 0, 20, 20)],
      [edge('w1', 'e', 'a', 'walk'), edge('w2', 'a', 'b', 'walk')],
    );
    const { steps } = stepsFor(g, 'e', 'b');
    expect(walks(steps).map((w) => w.turn)).toEqual([null, 'right']);
    expect(steps[0]).toMatchObject({ kind: 'start', place: { type: 'entrance', label: null } });
  });

  it('folds a short corridor jog into the walk instead of announcing two turns', () => {
    const g = graph(
      [
        at('e', 'entrance', 0, 0, 0),
        at('a', 'junction', 0, 0, 20),
        at('b', 'junction', 0, 4, 20),
        at('c', 'junction', 0, 4, 40),
      ],
      [edge('w1', 'e', 'a', 'walk'), edge('w2', 'a', 'b', 'walk'), edge('w3', 'b', 'c', 'walk')],
    );
    const { steps } = stepsFor(g, 'e', 'c');
    expect(kinds(steps)).toEqual(['start', 'walk', 'arrive']);
  });

  it('merges the cab hops and the shaft into one ride and uses the exit hop as the heading', () => {
    const entrance = { ...at('e', 'entrance', 0, 0, 0), name: { ja: 'A1' } };
    const g = graph(
      [
        entrance,
        at('cab0', 'elevator', 0, 0, 1.5),
        at('cab2', 'elevator', -2, 0, 1.5),
        at('hall', 'elevator', -2, 3, 1.5),
        at('x', 'junction', -2, 3, -18.5),
      ],
      [
        edge('hopIn', 'e', 'cab0', 'elevator'),
        edge('shaft', 'cab0', 'cab2', 'elevator'),
        edge('hopOut', 'cab2', 'hall', 'elevator'),
        edge('w', 'hall', 'x', 'walk'),
      ],
    );
    const { steps, route } = stepsFor(g, 'e', 'x');
    expect(kinds(steps)).toEqual(['start', 'elevator', 'walk', 'arrive']);
    expect(steps[1]).toMatchObject({
      kind: 'elevator',
      direction: 'down',
      fromLevel: 0,
      toLevel: -2,
      panel: 0,
      toPanel: -2,
      entrance: { label: 'A1', distanceM: 0 },
      legStart: 0,
      legEnd: 3,
    });
    // Leaving the cab eastwards and then walking south is a right turn.
    expect(walks(steps)[0]?.turn).toBe('right');
    expect(route.summary.elevators).toBe(1);
    expect(steps[3]).toMatchObject({ kind: 'arrive', panel: -2 });
  });

  it('shows a ride to a mezzanine on the floor below it', () => {
    const g = graph(
      [at('a', 'elevator', 0, 0, 0), at('b', 'elevator', -0.5, 0, 0)],
      [edge('lift', 'a', 'b', 'elevator')],
    );
    const { steps } = stepsFor(g, 'a', 'b');
    expect(steps[1]).toMatchObject({ kind: 'elevator', toLevel: -0.5, toPanel: -1 });
  });

  it('does not describe an underground elevator by a street entrance above it', () => {
    const g = graph(
      [
        { ...at('e', 'entrance', 0, 0, 0), name: { ja: 'A1' } },
        at('h', 'junction', -1, 1, 1),
        at('a', 'elevator', -1, 1, 1),
        at('b', 'elevator', -3, 1, 1),
      ],
      [
        edge('w', 'e', 'h', 'walk'),
        edge('hop', 'h', 'a', 'walk'),
        edge('lift', 'a', 'b', 'elevator'),
      ],
    );
    const { steps } = stepsFor(g, 'a', 'b');
    expect(steps[1]).toMatchObject({ kind: 'elevator', entrance: null });
  });

  it('names the nearest labelled entrance for a street elevator, up to 30 m away', () => {
    const near = graph(
      [
        { ...at('e', 'entrance', 0, 0, 0), name: { ja: 'B2' } },
        at('s', 'street', 0, 12, 0),
        at('a', 'elevator', 0, 12, 1),
        at('b', 'elevator', -2, 12, 1),
      ],
      [edge('w', 's', 'a', 'walk'), edge('lift', 'a', 'b', 'elevator')],
    );
    const { steps } = stepsFor(near, 's', 'b');
    expect(steps[0]).toMatchObject({ kind: 'start', place: { type: 'street' } });
    expect(steps[2]).toMatchObject({ kind: 'elevator', entrance: { label: 'B2', distanceM: 12 } });

    const far = graph(
      near.nodes.map((n) => (n.id === 'e' ? at('e', 'entrance', 0, -40, 0) : n)),
      near.edges,
    );
    expect(stepsFor(far, 's', 'b').steps[2]).toMatchObject({ kind: 'elevator', entrance: null });
  });

  it('sums ramps on a stretch and flags edges whose slope is unknown', () => {
    const g = graph(
      [
        at('a', 'junction', -1, 0, 0),
        at('b', 'junction', -1, 0, 20),
        at('c', 'junction', -1, 0, 40),
      ],
      [
        edge('r1', 'a', 'b', 'ramp', { slopePct: 8, lengthM: 20 }),
        withoutSlope(edge('r2', 'b', 'c', 'ramp', { lengthM: 20 })),
      ],
    );
    const { steps, route } = stepsFor(g, 'a', 'c');
    expect(route.uncertainEdgeIds).toEqual(['r2']);
    expect(walks(steps)).toHaveLength(1);
    expect(walks(steps)[0]).toMatchObject({
      ramps: { count: 2, lengthM: 40, maxSlopePct: 8 },
      uncertainEdgeIds: ['r2'],
    });
  });

  it('marks the gate as "out" when the route starts on a platform', () => {
    const g = graph(
      [at('p', 'platform', -2, 0, 0), at('g1', 'gate', -2, 0, 10), at('g2', 'gate', -2, 0, 13)],
      [edge('w', 'p', 'g1', 'walk'), edge('gate', 'g1', 'g2', 'fare_gate')],
    );
    const { steps } = stepsFor(g, 'p', 'g2');
    expect(steps.find((s) => s.kind === 'fare_gate')).toMatchObject({ direction: 'out' });
    expect(steps[0]).toMatchObject({ place: { type: 'platform' } });
  });

  it('gives stairs and escalators their own steps when the profile takes them', () => {
    const { steps } = stepsFor(twoRouteGraph(), 'street', 'gate', 'sensory');
    expect(kinds(steps)).toEqual(['start', 'stairs', 'escalator', 'arrive']);
    expect(steps[1]).toMatchObject({ direction: 'down', panel: 0, toPanel: -1 });
    // Same level at both ends: the data does not say whether it goes up or down.
    expect(steps[2]).toMatchObject({ direction: 'unknown' });
  });

  it('handles a route with no legs (already there)', () => {
    const g = graph([at('p', 'platform', -1, 0, 0)], []);
    const { steps } = stepsFor(g, 'p', 'p');
    expect(kinds(steps)).toEqual(['start', 'arrive']);
  });
});
