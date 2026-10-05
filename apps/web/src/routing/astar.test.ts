import { describe, expect, it } from 'vitest';
import { dijkstraCost, findRoute, indexGraph } from './astar';
import { edge, graph, node, twoRouteGraph } from './fixtures';
import { buildOutageIndex } from './outages';
import type { OutageReport } from './types';

const index = indexGraph(twoRouteGraph());

describe('findRoute', () => {
  it('sensory takes the faster stairs-and-escalator route', () => {
    const r = findRoute(index, { from: 'street', to: 'gate', profile: 'sensory' });
    expect(r.ok && r.legs.map((l) => l.edge.id)).toEqual(['stairs', 'esc']);
    expect(r.ok && r.summary).toMatchObject({ seconds: 10, elevators: 0 });
  });

  it('wheelchair takes the elevator', () => {
    const r = findRoute(index, { from: 'street', to: 'gate', profile: 'wheelchair' });
    expect(r.ok && r.legs.map((l) => l.edge.id)).toEqual(['lift']);
    expect(r.ok && r.summary).toMatchObject({ seconds: 40, elevators: 1, levelChanges: 1 });
  });

  it('walks edges backwards when they are bidirectional', () => {
    const r = findRoute(index, { from: 'gate', to: 'street', profile: 'wheelchair' });
    expect(r.ok && r.legs[0]?.forward).toBe(false);
  });

  it('respects one-way edges', () => {
    const g = graph(
      [node('a'), node('b')],
      [edge('ab', 'a', 'b', 'walk', { bidirectional: false })],
    );
    const i = indexGraph(g);
    expect(findRoute(i, { from: 'a', to: 'b', profile: 'sensory' }).ok).toBe(true);
    const back = findRoute(i, { from: 'b', to: 'a', profile: 'sensory' });
    expect(back).toMatchObject({ ok: false, failure: { reason: 'disconnected' } });
  });

  it('accepts several origins and destinations and picks the cheapest pair', () => {
    const g = graph(
      [node('a'), node('b'), node('p1'), node('p2')],
      [
        edge('a-p1', 'a', 'p1', 'walk', { seconds: 100 }),
        edge('b-p2', 'b', 'p2', 'walk', { seconds: 10 }),
      ],
    );
    const r = findRoute(indexGraph(g), { from: ['a', 'b'], to: ['p1', 'p2'], profile: 'sensory' });
    expect(r.ok && r.nodes).toEqual(['b', 'p2']);
  });

  it('returns a zero-length route when origin is a destination', () => {
    const r = findRoute(index, { from: 'gate', to: ['gate'], profile: 'wheelchair' });
    expect(r.ok && r.legs).toEqual([]);
  });

  it('lists edges with unknown attributes as uncertain', () => {
    const e = edge('w', 'a', 'b', 'walk');
    delete (e as { slopePct?: number }).slopePct;
    const r = findRoute(indexGraph(graph([node('a'), node('b')], [e])), {
      from: 'a',
      to: 'b',
      profile: 'wheelchair',
    });
    expect(r.ok && r.uncertainEdgeIds).toEqual(['w']);
  });
});

describe('when there is no route (never an empty answer)', () => {
  it('names unknown nodes', () => {
    const r = findRoute(index, { from: 'nope', to: 'gate', profile: 'sensory' });
    expect(r).toMatchObject({ ok: false, failure: { reason: 'unknown_node', nodeIds: ['nope'] } });
    expect(!r.ok && r.alternatives.length).toBeGreaterThan(0);
  });

  it('says disconnected when the graph has no path at all', () => {
    const g = graph([node('a'), node('b')], []);
    const r = findRoute(indexGraph(g), { from: 'a', to: 'b', profile: 'sensory' });
    expect(r).toMatchObject({ ok: false, failure: { reason: 'disconnected' } });
    expect(!r.ok && r.alternatives).toContain('try_another_station');
  });

  it('says blocked_by_profile and counts what is in the way', () => {
    const g = graph([node('a'), node('b')], [edge('st', 'a', 'b', 'stairs')]);
    const r = findRoute(indexGraph(g), { from: 'a', to: 'b', profile: 'wheelchair' });
    expect(r).toMatchObject({
      ok: false,
      failure: { reason: 'blocked_by_profile', blockers: { stairs: 1 } },
    });
    expect(!r.ok && r.alternatives).toEqual(expect.arrayContaining(['ask_staff']));
  });

  it('says blocked_by_outage and names the broken edge', () => {
    const report: OutageReport = {
      id: 'r',
      pathwayId: null,
      edgeId: 'lift',
      stationId: 'T',
      status: 'out_of_service',
      createdAt: '2026-10-05T11:00:00Z',
      expiresAt: '2026-10-05T17:00:00Z',
      confirmations: 1,
      source: 'community',
    };
    const outages = buildOutageIndex([report], new Date('2026-10-05T12:00:00Z'));
    const r = findRoute(index, { from: 'street', to: 'gate', profile: 'wheelchair', outages });
    expect(r).toMatchObject({
      ok: false,
      failure: { reason: 'blocked_by_outage', outageEdgeIds: ['lift'] },
    });
    expect(!r.ok && r.alternatives).toContain('wait_for_repair');
  });

  it('still routes other profiles around the same outage', () => {
    const report: OutageReport = {
      id: 'r',
      pathwayId: null,
      edgeId: 'lift',
      stationId: 'T',
      status: 'out_of_service',
      createdAt: '2026-10-05T11:00:00Z',
      expiresAt: '2026-10-05T17:00:00Z',
      confirmations: 1,
      source: 'community',
    };
    const outages = buildOutageIndex([report], new Date('2026-10-05T12:00:00Z'));
    expect(findRoute(index, { from: 'street', to: 'gate', profile: 'sensory', outages }).ok).toBe(
      true,
    );
  });
});

describe('A* agrees with Dijkstra', () => {
  it('on a grid with mixed edge types', () => {
    const nodes = [];
    const edges = [];
    const N = 8;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++)
        nodes.push(node(`${x},${y}`, 'junction', 0, 139 + x * 0.0001, 35 + y * 0.0001));
    }
    let k = 0;
    const modes = ['walk', 'ramp', 'stairs', 'escalator'] as const;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
        ] as const) {
          if (x + dx >= N || y + dy >= N) continue;
          const mode = modes[(k * 7 + x * 3 + y) % 4] ?? 'walk';
          edges.push(
            edge(`e${k++}`, `${x},${y}`, `${x + dx},${y + dy}`, mode, {
              seconds: 5 + ((x * 31 + y * 17) % 13),
              slopePct: mode === 'ramp' ? 8 : 0,
            }),
          );
        }
      }
    }
    const i = indexGraph(graph(nodes, edges));
    for (const profile of ['wheelchair', 'walker_cane', 'low_stamina', 'sensory'] as const) {
      for (const [a, b] of [
        ['0,0', '7,7'],
        ['7,0', '0,7'],
        ['3,3', '6,1'],
      ] as const) {
        const r = findRoute(i, { from: a, to: b, profile });
        const d = dijkstraCost(i, a, b, profile);
        if (r.ok) expect(r.legs.reduce((s, l) => s + l.cost, 0)).toBeCloseTo(d ?? NaN, 6);
        else expect(d).toBeUndefined();
      }
    }
  });
});
