/**
 * Joins OTP's train legs and the in-station routes into one journey (step 2.4, D-024).
 *
 * For each train itinerary: the stations where the person enters, changes and leaves are routed
 * with the station graph when there is one (tier 2), with the profile and the active outages. A
 * station with no step-free route rejects the itinerary, with the reason. Stations without a
 * graph (tier 1) are named and marked as not checked; nothing is promised about them.
 *
 * Where to ride: the in-station route at the station where the person gets off starts somewhere
 * on the platform; that point's front / middle / back (boarding.ts) is where to ride, and the
 * route at the boarding station then heads for that part of the platform when it can.
 */
import { boardingPosition } from '../../routing/boarding';
import type { BoardingPosition, TrainPart } from '../../routing/boarding';
import type { GraphIndex } from '../../routing/astar';
import type { GraphNode, NodeId, ProfileId, RouteResult } from '../../routing/types';
import type {
  Itinerary,
  Journey,
  JourneyRequest,
  LatLon,
  Rejection,
  RideAdvice,
  RideLeg,
  RouteOk,
  Segment,
  StationSegment,
  StreetWalk,
  WalkLeg,
} from './types';

/** Time allowed on top of the modelled in-station time before a train (an assumption, D-024). */
export const MARGIN_S = 120;
/** A transfer is "tight" when the in-station route plus this exceeds the timetable gap. */
export const TRANSFER_MARGIN_S = 60;
/** Straight-line street estimate used to choose an entrance: detour factor and walking speed. */
const DETOUR = 1.3;
const STREET_MPS = 1.0;

export interface StationRouteQuery {
  from: NodeId[];
  to: NodeId[];
  profile: ProfileId;
  blockedEdgeIds: string[];
  fromCost?: Record<NodeId, number>;
  toCost?: Record<NodeId, number>;
}

export interface AssembleDeps {
  /** The station's graph, or null when it has none (tier 1). */
  graph(stationId: string): Promise<GraphIndex | null>;
  route(stationId: string, query: StationRouteQuery): Promise<RouteResult>;
  /** A street walk, or null when it cannot be routed. */
  walk(from: LatLon, to: LatLon): Promise<{ distanceM: number; seconds: number } | null>;
}

export interface AssembleInput {
  request: JourneyRequest;
  /** Edges out of service, per station. */
  blocked: Readonly<Partial<Record<string, readonly string[]>>>;
}

export type Assembled = { ok: true; journey: Journey } | { ok: false; rejection: Rejection };

type Role = StationSegment['role'];

export function metres(a: LatLon, b: LatLon): number {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot((a.lon - b.lon) * 111_320 * k, (a.lat - b.lat) * 110_540);
}

const addSeconds = (iso: string, s: number): string =>
  new Date(Date.parse(iso) + s * 1000).toISOString();

function streetNodes(index: GraphIndex): GraphNode[] {
  // As in the station planner: street nodes too, since at 新宿 the only step-free way in is one.
  return index.graph.nodes.filter((n) => n.kind === 'entrance' || n.kind === 'street');
}

function platformNodes(index: GraphIndex, platformId: string | null): NodeId[] | null {
  const p = index.graph.station.platforms.find((x) => x.id === platformId);
  return p && p.nodeIds.length > 0 ? p.nodeIds : null;
}

function nodesInPart(
  index: GraphIndex,
  platformId: string,
  nodes: NodeId[],
  part: TrainPart,
): NodeId[] {
  return nodes.filter((id) => boardingPosition(index, platformId, id)?.part === part);
}

/** Straight-line street cost from a point to each street node, to choose the entrance. */
function streetCosts(nodes: GraphNode[], point: LatLon): Record<NodeId, number> {
  const out: Record<NodeId, number> = {};
  for (const n of nodes) out[n.id] = (metres(point, n) * DETOUR) / STREET_MPS;
  return out;
}

async function streetWalk(deps: AssembleDeps, from: LatLon, to: LatLon): Promise<StreetWalk> {
  const routed = await deps.walk(from, to).catch(() => null);
  if (routed) return { ...routed, source: 'otp' };
  const d = metres(from, to);
  return { distanceM: d, seconds: (d * DETOUR) / STREET_MPS, source: 'straight_line' };
}

/** Routes inside a station, trying the preferred targets first, then all of them. */
async function routeWithFallback(
  deps: AssembleDeps,
  stationId: string,
  base: Omit<StationRouteQuery, 'to'>,
  preferred: NodeId[] | null,
  all: NodeId[],
): Promise<RouteResult> {
  if (preferred && preferred.length > 0 && preferred.length < all.length) {
    const r = await deps.route(stationId, { ...base, to: preferred });
    if (r.ok) return r;
  }
  return deps.route(stationId, { ...base, to: all });
}

function reject(stationId: string, role: Role, r: Extract<RouteResult, { ok: false }>): Assembled {
  return {
    ok: false,
    rejection: { stationId, role, failure: r.failure, alternatives: r.alternatives },
  };
}

function lastNode(route: RouteOk): NodeId | undefined {
  return route.nodes[route.nodes.length - 1];
}

export async function assembleJourney(
  itinerary: Itinerary,
  input: AssembleInput,
  deps: AssembleDeps,
): Promise<Assembled> {
  const { request } = input;
  const { profile } = request;
  const rides = itinerary.legs.filter((l): l is RideLeg => l.kind === 'ride');
  const first = rides[0];
  const last = rides[rides.length - 1];
  if (!first || !last) throw new Error('itinerary without a train');
  const blocked = (id: string): string[] => [...(input.blocked[id] ?? [])];
  const origin = request.from.kind === 'point' ? request.from : null;
  const destination = request.to.kind === 'point' ? request.to : null;

  // Built from the end backwards, so each ride knows where to ride before its boarding route.
  const tail: Segment[] = [];
  const advice: (RideAdvice | null)[] = rides.map(() => null);

  // --- Leaving the last station ---
  const exitId = last.to.stationId ?? '';
  const exitIndex = await deps.graph(exitId);
  const exitPlatform = exitIndex && platformNodes(exitIndex, last.to.stopId);
  const walkAtEnd = itinerary.legs[itinerary.legs.length - 1];
  if (exitIndex && exitPlatform) {
    const streets = streetNodes(exitIndex);
    const r = await deps.route(exitId, {
      from: exitPlatform,
      to: streets.map((n) => n.id),
      profile,
      blockedEdgeIds: blocked(exitId),
      ...(destination && { toCost: streetCosts(streets, destination) }),
    });
    if (!r.ok) return reject(exitId, 'egress', r);
    const start = r.nodes[0];
    const position = start ? boardingPosition(exitIndex, last.to.stopId, start) : null;
    if (position) advice[rides.length - 1] = { position, stationId: exitId, purpose: 'exit' };
    tail.unshift({
      kind: 'station',
      role: 'egress',
      stationId: exitId,
      tier: 2,
      route: r,
      boardAt: null,
    });
    if (destination) {
      const end = exitIndex.nodes.get(lastNode(r) ?? '');
      if (end) {
        tail.push({
          kind: 'street',
          role: 'egress',
          place: destination,
          ...(await streetWalk(deps, end, destination)),
        });
      }
    }
  } else {
    tail.unshift({ kind: 'station', role: 'egress', stationId: exitId, tier: 1, walk: null });
    if (destination && walkAtEnd?.kind === 'walk') {
      tail.push({
        kind: 'street',
        role: 'egress',
        place: destination,
        distanceM: walkAtEnd.distanceM,
        seconds: walkAtEnd.seconds,
        source: 'otp',
      });
    }
  }

  // --- Rides and transfers, last to first ---
  const tightTransfers: string[] = [];
  for (let i = rides.length - 1; i >= 0; i--) {
    const ride = rides[i] as RideLeg;
    tail.unshift({ kind: 'ride', leg: ride, advice: advice[i] ?? null });
    if (i === 0) break;
    const prev = rides[i - 1] as RideLeg;
    const walk = itinerary.legs.find(
      (l): l is WalkLeg =>
        l.kind === 'walk' && l.from.stopId === prev.to.stopId && l.to.stopId === ride.from.stopId,
    );
    const atId = prev.to.stationId ?? '';
    const sameStation = atId !== '' && atId === ride.from.stationId;
    const index = sameStation ? await deps.graph(atId) : null;
    const fromNodes = index && platformNodes(index, prev.to.stopId);
    const toNodes = index && platformNodes(index, ride.from.stopId);
    if (index && fromNodes && toNodes) {
      const part = advice[i]?.position.part;
      const preferred =
        part && ride.from.stopId ? nodesInPart(index, ride.from.stopId, toNodes, part) : null;
      const r = await routeWithFallback(
        deps,
        atId,
        { from: fromNodes, profile, blockedEdgeIds: blocked(atId) },
        preferred,
        toNodes,
      );
      if (!r.ok) return reject(atId, 'transfer', r);
      const start = r.nodes[0];
      const position = start ? boardingPosition(index, prev.to.stopId, start) : null;
      if (position) advice[i - 1] = { position, stationId: atId, purpose: 'transfer' };
      const end = lastNode(r);
      tail.unshift({
        kind: 'station',
        role: 'transfer',
        stationId: atId,
        tier: 2,
        route: r,
        boardAt: end ? boardingPosition(index, ride.from.stopId, end) : null,
      });
      const gap = (Date.parse(ride.departure) - Date.parse(prev.arrival)) / 1000;
      if (r.summary.seconds + TRANSFER_MARGIN_S > gap) tightTransfers.push(atId);
    } else if (sameStation) {
      tail.unshift({
        kind: 'station',
        role: 'transfer',
        stationId: atId,
        tier: 1,
        walk: walk ?? null,
      });
    } else {
      // Two different stations (蔵前 Ōedo to 蔵前 Asakusa): OTP's walk, not checked for steps.
      tail.unshift({
        kind: 'station',
        role: 'transfer',
        stationId: ride.from.stationId ?? '',
        tier: 1,
        walk: null,
      });
      if (walk) tail.unshift({ kind: 'walk', leg: walk });
      tail.unshift({ kind: 'station', role: 'transfer', stationId: atId, tier: 1, walk: null });
    }
  }

  // --- Entering the first station ---
  const head: Segment[] = [];
  const entryId = first.from.stationId ?? '';
  const entryIndex = await deps.graph(entryId);
  const entryPlatform = entryIndex && platformNodes(entryIndex, first.from.stopId);
  const walkAtStart = itinerary.legs[0];
  let accessSeconds: number | null = null;
  if (entryIndex && entryPlatform) {
    const streets = streetNodes(entryIndex);
    const part = advice[0]?.position.part;
    const preferred =
      part && first.from.stopId
        ? nodesInPart(entryIndex, first.from.stopId, entryPlatform, part)
        : null;
    const r = await routeWithFallback(
      deps,
      entryId,
      {
        from: streets.map((n) => n.id),
        profile,
        blockedEdgeIds: blocked(entryId),
        ...(origin && { fromCost: streetCosts(streets, origin) }),
      },
      preferred,
      entryPlatform,
    );
    if (!r.ok) return reject(entryId, 'access', r);
    accessSeconds = r.summary.seconds;
    if (origin) {
      const startNode = entryIndex.nodes.get(r.nodes[0] ?? '');
      if (startNode) {
        const walk = await streetWalk(deps, origin, startNode);
        head.push({ kind: 'street', role: 'access', place: origin, ...walk });
        accessSeconds += walk.seconds;
      }
    }
    const end = lastNode(r);
    head.push({
      kind: 'station',
      role: 'access',
      stationId: entryId,
      tier: 2,
      route: r,
      boardAt: end ? boardingPosition(entryIndex, first.from.stopId, end) : null,
    });
  } else {
    if (origin && walkAtStart?.kind === 'walk') {
      head.push({
        kind: 'street',
        role: 'access',
        place: origin,
        distanceM: walkAtStart.distanceM,
        seconds: walkAtStart.seconds,
        source: 'otp',
      });
    }
    head.push({ kind: 'station', role: 'access', stationId: entryId, tier: 1, walk: null });
  }

  const segments = [...head, ...tail];
  let egressSeconds = 0;
  for (const s of tail) {
    if (s.kind === 'station' && s.role === 'egress' && s.tier === 2)
      egressSeconds += s.route.summary.seconds;
    if (s.kind === 'street' && s.role === 'egress') egressSeconds += s.seconds;
  }
  const unverified = [
    ...new Set(
      segments.flatMap((s) => (s.kind === 'station' && s.tier === 1 ? [s.stationId] : [])),
    ),
  ];
  return {
    ok: true,
    journey: {
      segments,
      leaveAt:
        accessSeconds === null
          ? origin && walkAtStart?.kind === 'walk'
            ? walkAtStart.departure
            : null
          : addSeconds(first.departure, -(accessSeconds + MARGIN_S)),
      firstDeparture: first.departure,
      arriveAt: addSeconds(last.arrival, egressSeconds),
      rides: rides.length,
      elevatorRides: segments.reduce(
        (n, s) => n + (s.kind === 'station' && s.tier === 2 ? s.route.summary.elevators : 0),
        0,
      ),
      unverifiedStations: unverified,
      tightTransfers,
      itinerary,
    },
  };
}

export interface Planned {
  journeys: Journey[];
  /** Why itineraries were dropped, one per itinerary that had no step-free route. */
  rejections: Rejection[];
}

/** How many journeys to show. */
export const SHOWN = 3;

/**
 * Assembles every itinerary, drops the ones that leave before the requested time or have no
 * step-free route, and keeps the earliest arrivals.
 */
export async function assembleAll(
  itineraries: readonly Itinerary[],
  input: AssembleInput,
  deps: AssembleDeps,
): Promise<Planned> {
  const results = await Promise.all(itineraries.map((it) => assembleJourney(it, input, deps)));
  const journeys: Journey[] = [];
  const rejections: Rejection[] = [];
  const earliest = Date.parse(input.request.time);
  for (const r of results) {
    if (!r.ok) rejections.push(r.rejection);
    else if (r.journey.leaveAt === null || Date.parse(r.journey.leaveAt) >= earliest - 30_000)
      journeys.push(r.journey);
  }
  journeys.sort(
    (a, b) =>
      Date.parse(a.arriveAt) - Date.parse(b.arriveAt) ||
      a.rides - b.rides ||
      a.elevatorRides - b.elevatorRides,
  );
  return { journeys: journeys.slice(0, SHOWN), rejections };
}

export type { BoardingPosition };
