/// <reference types="node" />
/**
 * Golden-route tests on the real station graphs built by the importer
 * (`cd importer && uv run python -m importer.run --stations oedo`). They are skipped when
 * data/build/graphs is missing, so a fresh clone can still run `pnpm test`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dijkstraCost, findRoute, indexGraph } from './astar';
import type { GraphIndex } from './astar';
import { buildOutageIndex } from './outages';
import type { OutageReport, ProfileId, RouteResult, StationGraph } from './types';

const DIR = resolve(import.meta.dirname, '../../../../data/build/graphs');
const HAVE_DATA = existsSync(resolve(DIR, '421.json'));

const cache = new Map<string, GraphIndex>();
function load(id: string): GraphIndex {
  let idx = cache.get(id);
  if (!idx) {
    idx = indexGraph(JSON.parse(readFileSync(resolve(DIR, `${id}.json`), 'utf-8')) as StationGraph);
    cache.set(id, idx);
  }
  return idx;
}

const STATIONS = [
  '402',
  '403',
  '410',
  '421',
  '422',
  '423',
  '424',
  '425',
  '426',
  '427',
  '428',
  '429',
];

function ids(idx: GraphIndex, kind: string): string[] {
  return idx.graph.nodes.filter((n) => n.kind === kind).map((n) => n.id);
}

function platformNodes(idx: GraphIndex, platformId: string): string[] {
  return idx.graph.station.platforms.find((p) => p.id === platformId)?.nodeIds ?? [];
}

function modes(r: RouteResult): string[] {
  return r.ok ? r.legs.map((l) => l.edge.mode) : [];
}

describe.skipIf(!HAVE_DATA)('大門 (421): street to Ōedo platform, wheelchair', () => {
  const idx = HAVE_DATA ? load('421') : (undefined as never);

  it.each(['421P3', '421P4'])(
    'reaches platform %s from the entrances without stairs or escalators',
    (p) => {
      const r = findRoute(idx, {
        from: ids(idx, 'entrance'),
        to: platformNodes(idx, p),
        profile: 'wheelchair',
      });
      expect(r.ok).toBe(true);
      expect(modes(r)).not.toContain('stairs');
      expect(modes(r)).not.toContain('escalator');
      expect(r.ok && r.summary.elevators).toBeGreaterThanOrEqual(1);
      expect(r.ok && r.summary.seconds).toBeGreaterThan(60);
      expect(r.ok && r.summary.seconds).toBeLessThan(900);
      const last = r.ok ? r.nodes[r.nodes.length - 1] : undefined;
      expect(platformNodes(idx, p)).toContain(last);
    },
  );

  it('works in the other direction too (platform to street)', () => {
    const r = findRoute(idx, {
      from: platformNodes(idx, '421P3'),
      to: ids(idx, 'entrance'),
      profile: 'wheelchair',
    });
    expect(r.ok).toBe(true);
    expect(modes(r)).not.toContain('stairs');
  });

  it('is faster with stairs when the profile allows them', () => {
    const args = { from: ids(idx, 'entrance'), to: platformNodes(idx, '421P3') };
    const wheel = findRoute(idx, { ...args, profile: 'wheelchair' });
    const sensory = findRoute(idx, { ...args, profile: 'sensory' });
    expect(wheel.ok && sensory.ok).toBe(true);
    if (wheel.ok && sensory.ok)
      expect(sensory.summary.seconds).toBeLessThanOrEqual(wheel.summary.seconds);
  });

  it('reroutes when an elevator on the route is reported out of service', () => {
    const args = {
      from: ids(idx, 'entrance'),
      to: platformNodes(idx, '421P3'),
      profile: 'wheelchair' as const,
    };
    const before = findRoute(idx, args);
    if (!before.ok) throw new Error('baseline route missing');
    const lift = before.legs.find((l) => l.edge.mode === 'elevator');
    if (!lift) throw new Error('baseline has no elevator');
    const report: OutageReport = {
      id: 'demo',
      pathwayId: lift.edge.pathwayId ?? null,
      edgeId: lift.edge.id,
      stationId: '421',
      status: 'out_of_service',
      createdAt: '2026-10-05T11:00:00Z',
      expiresAt: '2026-10-05T17:00:00Z',
      confirmations: 1,
      source: 'community',
    };
    const outages = buildOutageIndex([report], new Date('2026-10-05T12:00:00Z'));
    const after = findRoute(idx, { ...args, outages });
    if (after.ok) {
      expect(after.legs.map((l) => l.edge.id)).not.toContain(lift.edge.id);
    } else {
      // No alternative: the answer must name the broken lift, not be empty.
      expect(after.failure).toMatchObject({ reason: 'blocked_by_outage' });
      expect(JSON.stringify(after.failure)).toContain(lift.edge.id);
    }
    // Clearing the report restores the original route.
    const cleared = buildOutageIndex(
      [report, { ...report, id: 'fixed', status: 'working', createdAt: '2026-10-05T11:30:00Z' }],
      new Date('2026-10-05T12:00:00Z'),
    );
    const restored = findRoute(idx, { ...args, outages: cleared });
    expect(restored.ok && restored.summary.seconds).toBe(before.summary.seconds);
  });
});

describe.skipIf(!HAVE_DATA)('stations whose only step-free way down is a steep ramp', () => {
  it.each(['402', '423'])('%s: wheelchair gets a reason, other profiles get a route', (id) => {
    const idx = load(id);
    const platforms = idx.graph.station.platforms.flatMap((p) => p.nodeIds);
    const from = ids(idx, 'entrance');
    const wheel = findRoute(idx, { from, to: platforms, profile: 'wheelchair' });
    expect(wheel.ok).toBe(false);
    if (!wheel.ok) {
      expect(wheel.failure.reason).toBe('blocked_by_profile');
      if (wheel.failure.reason === 'blocked_by_profile') {
        // the reason must be about the data, not about stairs alone
        expect(
          wheel.failure.blockers.slope_too_steep + wheel.failure.blockers.step_too_high,
        ).toBeGreaterThan(0);
      }
      expect(wheel.alternatives).toContain('ask_staff');
    }
    for (const profile of [
      'walker_cane',
      'stroller_luggage',
      'low_stamina',
      'sensory',
    ] as ProfileId[]) {
      expect(findRoute(idx, { from, to: platforms, profile }).ok, profile).toBe(true);
    }
  });
});

describe.skipIf(!HAVE_DATA)('新宿 (428): the step-free exit is an unnamed street node', () => {
  const idx = HAVE_DATA ? load('428') : (undefined as never);
  const platforms = HAVE_DATA ? idx.graph.station.platforms.flatMap((p) => p.nodeIds) : [];

  it('has no wheelchair route from the listed entrances', () => {
    const r = findRoute(idx, { from: ids(idx, 'entrance'), to: platforms, profile: 'wheelchair' });
    expect(r).toMatchObject({ ok: false, failure: { reason: 'blocked_by_profile' } });
  });

  it('has one from a street node', () => {
    const r = findRoute(idx, { from: ids(idx, 'street'), to: platforms, profile: 'wheelchair' });
    expect(r.ok).toBe(true);
    expect(modes(r)).not.toContain('stairs');
  });
});

describe.skipIf(!HAVE_DATA)('every Ōedo station graph', () => {
  it.each(STATIONS)(
    '%s: every platform is reachable from the entrances for the sensory profile',
    (id) => {
      const idx = load(id);
      for (const p of idx.graph.station.platforms) {
        const r = findRoute(idx, { from: ids(idx, 'entrance'), to: p.nodeIds, profile: 'sensory' });
        expect(r.ok, `${id} ${p.id}`).toBe(true);
      }
    },
  );

  it.each(STATIONS)('%s: A* matches Dijkstra on sampled pairs (wheelchair)', (id) => {
    const idx = load(id);
    const nodes = idx.graph.nodes.map((n) => n.id);
    for (let k = 0; k < 15; k++) {
      const a = nodes[(k * 37) % nodes.length];
      const b = nodes[(k * 91 + 13) % nodes.length];
      if (!a || !b) continue;
      const r = findRoute(idx, { from: a, to: b, profile: 'wheelchair' });
      const d = dijkstraCost(idx, a, b, 'wheelchair');
      if (r.ok) expect(r.legs.reduce((s, l) => s + l.cost, 0)).toBeCloseTo(d ?? NaN, 6);
      else expect(d).toBeUndefined();
    }
  });

  it('re-routes in well under 100 ms (budget is 100 ms on a mid-range phone)', () => {
    const idx = load('421');
    const from = ids(idx, 'entrance');
    const to = platformNodes(idx, '421P3');
    const times: number[] = [];
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now();
      findRoute(idx, { from, to, profile: 'wheelchair' });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)] ?? Infinity).toBeLessThan(20);
  });
});
