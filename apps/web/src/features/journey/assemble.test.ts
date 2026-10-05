/// <reference types="node" />
/**
 * Journeys from recorded OTP answers (fixtures/, scripts/record-otp.mjs) and the real station
 * graphs. Skipped when data/build/graphs is missing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { findRoute, indexGraph } from '../../routing/astar';
import type { GraphIndex } from '../../routing/astar';
import { buildOutageIndex } from '../../routing/outages';
import type { StationGraph } from '../../routing/types';
import { MARGIN_S, assembleAll, assembleJourney } from './assemble';
import type { AssembleDeps } from './assemble';
import { parsePlan } from './otp';
import type { Itinerary, JourneyRequest, Place } from './types';

const DIR = resolve(import.meta.dirname, '../../../../../data/build/graphs');
const HAVE_DATA = existsSync(resolve(DIR, '421.json'));

const graphs = new Map<string, GraphIndex>();
function graph(id: string): GraphIndex | null {
  if (!existsSync(resolve(DIR, `${id}.json`)) || !/^\d+$/.test(id)) return null;
  let g = graphs.get(id);
  if (!g) {
    g = indexGraph(JSON.parse(readFileSync(resolve(DIR, `${id}.json`), 'utf-8')) as StationGraph);
    graphs.set(id, g);
  }
  return g;
}

function deps(walk: AssembleDeps['walk'] = () => Promise.resolve(null)): AssembleDeps {
  return {
    graph: (id) => Promise.resolve(graph(id)),
    route: (id, q) => {
      const g = graph(id);
      if (!g) throw new Error(`no graph ${id}`);
      return Promise.resolve(
        findRoute(g, {
          from: q.from,
          to: q.to,
          profile: q.profile,
          outages: buildOutageIndex(
            q.blockedEdgeIds.map((edgeId) => ({
              id: edgeId,
              edgeId,
              pathwayId: null,
              stationId: id,
              status: 'out_of_service',
              createdAt: '2026-10-07T00:00:00Z',
              expiresAt: '2026-10-08T00:00:00Z',
              confirmations: 1,
              source: 'community',
            })),
            new Date('2026-10-07T03:00:00Z'),
          ),
          ...(q.fromCost && { fromCost: q.fromCost }),
          ...(q.toCost && { toCost: q.toCost }),
        }),
      );
    },
    walk,
  };
}

function fixture(name: string): Itinerary[] {
  const raw = JSON.parse(
    readFileSync(resolve(import.meta.dirname, 'fixtures', `${name}.json`), 'utf-8'),
  ) as { data: Parameters<typeof parsePlan>[0] };
  return parsePlan(raw.data);
}

const station = (id: string, ja: string): Place => ({
  kind: 'station',
  station: { id, otpId: `1:${id}`, name: { ja }, lat: 0, lon: 0, lines: [], tier: 2 },
});
const DAIMON = station('421', '大門');
const SHINJUKU = station('428', '新宿');
const TIME = '2026-10-07T08:50:00+09:00';
const request = (from: Place, to: Place, profile: JourneyRequest['profile'] = 'wheelchair') => ({
  request: { from, to, profile, time: TIME },
  blocked: {},
});

describe.skipIf(!HAVE_DATA)('大門 → 新宿, wheelchair', () => {
  it('is entrance, elevators to the platform, the Ōedo Line, and out at 新宿', async () => {
    const [first] = fixture('daimon-shinjuku');
    const r = await assembleJourney(first as Itinerary, request(DAIMON, SHINJUKU), deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const j = r.journey;
    expect(
      j.segments.map((s) => (s.kind === 'station' ? `${s.role}:${s.stationId}` : s.kind)),
    ).toEqual(['access:421', 'ride', 'egress:428']);
    const [access, ride, egress] = j.segments;
    expect(
      access?.kind === 'station' && access.tier === 2 && access.route.legs.length,
    ).toBeGreaterThan(0);
    // Never stairs or escalators for a wheelchair.
    for (const s of j.segments) {
      if (s.kind === 'station' && s.tier === 2) {
        expect(
          s.route.legs.some((l) => l.edge.mode === 'stairs' || l.edge.mode === 'escalator'),
        ).toBe(false);
      }
    }
    expect(ride?.kind === 'ride' && ride.leg.from.stopId).toBe('421P4');
    expect(ride?.kind === 'ride' && ride.leg.to.stopId).toBe('428P7');
    // Where to ride comes from where the 新宿 route leaves the platform.
    expect(ride?.kind === 'ride' && ride.advice?.purpose).toBe('exit');
    expect(ride?.kind === 'ride' && ride.advice?.stationId).toBe('428');
    // The 大門 route heads for that part of the platform.
    const part = ride?.kind === 'ride' ? ride.advice?.position.part : undefined;
    expect(access?.kind === 'station' && access.tier === 2 && access.boardAt?.part).toBe(part);
    expect(egress?.kind === 'station' && egress.tier).toBe(2);
    // Timing: leave early enough to reach the platform, arrive after the train plus the exit.
    const accessS =
      access?.kind === 'station' && access.tier === 2 ? access.route.summary.seconds : 0;
    expect(Date.parse(j.firstDeparture) - Date.parse(j.leaveAt ?? '')).toBe(
      (accessS + MARGIN_S) * 1000,
    );
    expect(Date.parse(j.arriveAt)).toBeGreaterThan(Date.parse(first?.end ?? ''));
    expect(j.unverifiedStations).toEqual([]);
    expect(j.elevatorRides).toBeGreaterThanOrEqual(2);
  });

  it('routes around a broken elevator at 大門, and says why when there is no way round', async () => {
    const [first] = fixture('daimon-shinjuku');
    const r = await assembleJourney(first as Itinerary, request(DAIMON, SHINJUKU), deps());
    if (!r.ok || r.journey.segments[0]?.kind !== 'station' || r.journey.segments[0].tier !== 2) {
      throw new Error('expected a route');
    }
    const lift = r.journey.segments[0].route.legs
      .filter((l) => l.edge.mode === 'elevator')
      .map((l) => l.edge.id);
    const around = await assembleJourney(
      first as Itinerary,
      { ...request(DAIMON, SHINJUKU), blocked: { '421': lift } },
      deps(),
    );
    if (around.ok) {
      const seg = around.journey.segments[0];
      expect(
        seg?.kind === 'station' &&
          seg.tier === 2 &&
          seg.route.legs.some((l) => lift.includes(l.edge.id)),
      ).toBe(false);
    } else {
      expect(around.rejection).toMatchObject({
        stationId: '421',
        role: 'access',
        failure: { reason: 'blocked_by_outage' },
      });
    }
    // Block every elevator in 大門: no step-free way to the platform.
    const all =
      graph('421')
        ?.graph.edges.filter((e) => e.mode === 'elevator')
        .map((e) => e.id) ?? [];
    const none = await assembleJourney(
      first as Itinerary,
      { ...request(DAIMON, SHINJUKU), blocked: { '421': all } },
      deps(),
    );
    expect(none).toMatchObject({ ok: false, rejection: { stationId: '421', role: 'access' } });
  });

  it('keeps the earliest three that can still be caught', async () => {
    const its = fixture('daimon-shinjuku');
    const planned = await assembleAll(its, request(DAIMON, SHINJUKU), deps());
    expect(planned.journeys).toHaveLength(3);
    expect(planned.rejections).toEqual([]);
    for (const j of planned.journeys)
      expect(Date.parse(j.leaveAt ?? '')).toBeGreaterThanOrEqual(Date.parse(TIME) - 30_000);
    const arrivals = planned.journeys.map((j) => Date.parse(j.arriveAt));
    expect([...arrivals].sort((a, b) => a - b)).toEqual(arrivals);
    // Leaving at 09:00 drops the trains that cannot be reached in time.
    const later = await assembleAll(
      its,
      {
        ...request(DAIMON, SHINJUKU),
        request: { ...request(DAIMON, SHINJUKU).request, time: '2026-10-07T09:00:00+09:00' },
      },
      deps(),
    );
    for (const j of later.journeys)
      expect(Date.parse(j.leaveAt ?? '')).toBeGreaterThanOrEqual(
        Date.parse('2026-10-07T09:00:00+09:00') - 30_000,
      );
  });
});

describe.skipIf(!HAVE_DATA)('other shapes of journey', () => {
  it('a tier-1 destination is named and marked not checked', async () => {
    const [first] = fixture('daimon-oshiage');
    const r = await assembleJourney(
      first as Itinerary,
      request(DAIMON, station('120', '押上')),
      deps(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const kinds = r.journey.segments.map((s) =>
      s.kind === 'station' ? `${s.role}:${s.tier}` : s.kind,
    );
    expect(kinds[0]).toBe('access:2');
    expect(kinds[kinds.length - 1]).toBe('egress:1');
    expect(r.journey.rides).toBe(2);
    // The change between two stations (Ōedo to Asakusa Line) is OTP's walk, not checked.
    expect(r.journey.unverifiedStations).toContain('120');
    expect(r.journey.unverifiedStations.length).toBeGreaterThanOrEqual(2);
  });

  it('from an address: street walk to the entrance the in-station route starts at', async () => {
    const tower: Place = {
      kind: 'point',
      lat: 35.65858,
      lon: 139.74543,
      label: '東京タワー',
      source: 'place',
    };
    const walk = vi.fn(() => Promise.resolve({ distanceM: 700, seconds: 600 }));
    const [first] = fixture('tower-shinjuku');
    const r = await assembleJourney(first as Itinerary, request(tower, SHINJUKU), deps(walk));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [street, access] = r.journey.segments;
    expect(street).toMatchObject({ kind: 'street', role: 'access', distanceM: 700, source: 'otp' });
    expect(access?.kind === 'station' && access.stationId).toBe('422');
    // The walk goes to where the in-station route starts.
    const startId =
      access?.kind === 'station' && access.tier === 2 ? access.route.nodes[0] : undefined;
    const start = graph('422')?.nodes.get(startId ?? '');
    expect(walk).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 35.65858 }),
      expect.objectContaining({ lat: start?.lat, lon: start?.lon }),
    );
    // Leave time counts the walk as well as the in-station route.
    const accessS =
      access?.kind === 'station' && access.tier === 2 ? access.route.summary.seconds : 0;
    expect(Date.parse(r.journey.firstDeparture) - Date.parse(r.journey.leaveAt ?? '')).toBe(
      (600 + accessS + MARGIN_S) * 1000,
    );
  });

  it('falls back to a straight-line estimate when the street walk cannot be routed, and says so', async () => {
    const tower: Place = {
      kind: 'point',
      lat: 35.65858,
      lon: 139.74543,
      label: '東京タワー',
      source: 'place',
    };
    const [first] = fixture('tower-shinjuku');
    const r = await assembleJourney(first as Itinerary, request(tower, SHINJUKU), deps());
    expect(r.ok && r.journey.segments[0]).toMatchObject({
      kind: 'street',
      source: 'straight_line',
    });
  });
});
