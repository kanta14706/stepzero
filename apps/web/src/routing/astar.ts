import { MinHeap } from './heap';
import { NO_OUTAGES, isBlocked } from './outages';
import type { OutageIndex } from './outages';
import { edgeCost } from './profiles';
import type {
  AlternativeCode,
  BlockReason,
  GraphEdge,
  GraphNode,
  NodeId,
  NoRoute,
  ProfileId,
  RouteLeg,
  RouteResult,
  StationGraph,
} from './types';

/** Fastest base speed in the graph (moving walkway), metres per second. */
const MAX_SPEED_MPS = 1.5;
/** Safety margin so the straight-line heuristic stays admissible despite rounding in the data. */
const HEURISTIC_SCALE = 0.9;

/** Extra cost (profile seconds) for starting or ending at a node, e.g. the street walk to it. */
export type EndCosts = Readonly<Partial<Record<NodeId, number>>>;

export interface RouteRequest {
  from: NodeId | readonly NodeId[];
  to: NodeId | readonly NodeId[];
  profile: ProfileId;
  outages?: OutageIndex;
  /** Cost of starting at each origin (missing = 0). Not part of the route's own seconds. */
  fromCost?: EndCosts;
  /** Cost of ending at each destination (missing = 0). Not part of the route's own seconds. */
  toCost?: EndCosts;
}

interface Arc {
  edge: GraphEdge;
  forward: boolean;
  to: NodeId;
}

/** Adjacency lists. Build once per graph; the worker keeps it. */
export interface GraphIndex {
  graph: StationGraph;
  nodes: Map<NodeId, GraphNode>;
  arcs: Map<NodeId, Arc[]>;
}

export function indexGraph(graph: StationGraph): GraphIndex {
  const nodes = new Map<NodeId, GraphNode>();
  for (const n of graph.nodes) nodes.set(n.id, n);
  const arcs = new Map<NodeId, Arc[]>();
  const add = (from: NodeId, arc: Arc) => {
    const list = arcs.get(from);
    if (list) list.push(arc);
    else arcs.set(from, [arc]);
  };
  for (const edge of graph.edges) {
    add(edge.from, { edge, forward: true, to: edge.to });
    if (edge.bidirectional) add(edge.to, { edge, forward: false, to: edge.from });
  }
  return { graph, nodes, arcs };
}

function haversineM(a: GraphNode, b: GraphNode): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

interface Search {
  cost: number;
  legs: RouteLeg[];
  nodes: NodeId[];
  uncertain: string[];
}

/**
 * A* from any of `sources` to any of `targets`. `costOf` returns `Infinity` for forbidden arcs.
 * With `heuristic = false` this is plain Dijkstra (used to cross-check A* in the tests).
 * `ends` adds a cost for starting or finishing at a node; the search then keeps going after the
 * first target until no cheaper finish is possible (the heuristic ignores end costs, so it stays
 * admissible).
 */
function search(
  index: GraphIndex,
  sources: readonly NodeId[],
  targets: readonly NodeId[],
  costOf: (arc: Arc) => { cost: number; uncertain: boolean },
  heuristic: boolean,
  ends: { from?: EndCosts | undefined; to?: EndCosts | undefined } = {},
): Search | undefined {
  const targetSet = new Set(targets);
  const targetNodes = targets.flatMap((t) => {
    const n = index.nodes.get(t);
    return n ? [n] : [];
  });
  const h = (id: NodeId): number => {
    if (!heuristic) return 0;
    const n = index.nodes.get(id);
    if (!n) return 0;
    let best = Infinity;
    for (const t of targetNodes) best = Math.min(best, haversineM(n, t));
    return (HEURISTIC_SCALE * best) / MAX_SPEED_MPS;
  };

  const g = new Map<NodeId, number>();
  const prev = new Map<NodeId, { from: NodeId; arc: Arc; cost: number; uncertain: boolean }>();
  const open = new MinHeap<NodeId>();
  for (const s of sources) {
    const start = ends.from?.[s] ?? 0;
    if (start < (g.get(s) ?? Infinity)) {
      g.set(s, start);
      open.push(start + h(s), s);
    }
  }
  const closed = new Set<NodeId>();
  let best: { node: NodeId; total: number } | null = null;

  const finish = (current: NodeId): Search => {
    const legs: RouteLeg[] = [];
    const uncertain: string[] = [];
    const nodes: NodeId[] = [current];
    for (let at = current, step = prev.get(at); step; step = prev.get(at)) {
      legs.push({
        edge: step.arc.edge,
        forward: step.arc.forward,
        from: step.from,
        to: at,
        seconds: step.arc.edge.seconds,
        cost: step.cost,
      });
      if (step.uncertain) uncertain.push(step.arc.edge.id);
      at = step.from;
      nodes.push(at);
    }
    legs.reverse();
    nodes.reverse();
    return { cost: g.get(current) ?? 0, legs, nodes, uncertain: uncertain.reverse() };
  };

  for (let top = open.pop(); top; top = open.pop()) {
    if (best && top.key >= best.total) break;
    const current = top.value;
    if (closed.has(current)) continue;
    closed.add(current);
    if (targetSet.has(current)) {
      const total = (g.get(current) ?? 0) + (ends.to?.[current] ?? 0);
      if (!ends.to) return finish(current);
      if (!best || total < best.total) best = { node: current, total };
    }
    const base = g.get(current) ?? Infinity;
    for (const arc of index.arcs.get(current) ?? []) {
      if (closed.has(arc.to)) continue;
      const { cost, uncertain } = costOf(arc);
      if (cost === Infinity) continue;
      const next = base + cost;
      if (next < (g.get(arc.to) ?? Infinity)) {
        g.set(arc.to, next);
        prev.set(arc.to, { from: current, arc, cost, uncertain });
        open.push(next + h(arc.to), arc.to);
      }
    }
  }
  return best ? finish(best.node) : undefined;
}

const asArray = (x: NodeId | readonly NodeId[]): readonly NodeId[] =>
  typeof x === 'string' ? [x] : x;

/** Why the search failed, and what the user can try instead. Never returns an empty answer. */
function explain(
  index: GraphIndex,
  sources: readonly NodeId[],
  targets: readonly NodeId[],
  profile: ProfileId,
  outages: OutageIndex,
): { failure: NoRoute; alternatives: AlternativeCode[] } {
  // 1. Any route at all, ignoring profile and outages?
  const anything = search(index, sources, targets, () => ({ cost: 1, uncertain: false }), false);
  if (!anything) {
    return {
      failure: { reason: 'disconnected' },
      alternatives: ['try_another_entrance', 'try_another_station', 'ask_staff'],
    };
  }
  // 2. A route for this profile if outages are ignored?
  const ignoringOutages = search(
    index,
    sources,
    targets,
    (arc) => ({ cost: edgeCost(profile, arc.edge).cost, uncertain: false }),
    false,
  );
  if (ignoringOutages) {
    const outageEdgeIds = ignoringOutages.legs
      .filter((l) => isBlocked(outages, l.edge))
      .map((l) => l.edge.id);
    return {
      failure: { reason: 'blocked_by_outage', outageEdgeIds },
      alternatives: ['wait_for_repair', 'try_another_entrance', 'ask_staff', 'use_accessible_bus'],
    };
  }
  // 3. Blocked by the profile: count which kinds of edge are in the way on the unconstrained route.
  const blockers: Record<BlockReason, number> = {
    stairs: 0,
    escalator: 0,
    slope_too_steep: 0,
    step_too_high: 0,
    outage: 0,
  };
  for (const leg of anything.legs) {
    const { blocked } = edgeCost(profile, leg.edge);
    if (blocked) blockers[blocked] += 1;
  }
  return {
    failure: { reason: 'blocked_by_profile', blockers },
    alternatives: [
      'try_another_entrance',
      'try_another_station',
      'ask_staff',
      'use_accessible_bus',
    ],
  };
}

/** Route between node sets under a profile and the active outages. */
export function findRoute(index: GraphIndex, request: RouteRequest): RouteResult {
  const sources = asArray(request.from);
  const targets = asArray(request.to);
  const outages = request.outages ?? NO_OUTAGES;

  const unknown = [...sources, ...targets].filter((id) => !index.nodes.has(id));
  if (unknown.length > 0 || sources.length === 0 || targets.length === 0) {
    return {
      ok: false,
      failure: { reason: 'unknown_node', nodeIds: unknown },
      alternatives: ['try_another_station', 'ask_staff'],
    };
  }

  const found = search(
    index,
    sources,
    targets,
    (arc) => {
      if (isBlocked(outages, arc.edge)) return { cost: Infinity, uncertain: false };
      const c = edgeCost(request.profile, arc.edge);
      return { cost: c.cost, uncertain: c.uncertain };
    },
    true,
    { from: request.fromCost, to: request.toCost },
  );
  if (!found) {
    const { failure, alternatives } = explain(index, sources, targets, request.profile, outages);
    return { ok: false, failure, alternatives };
  }

  const levels = found.nodes.map((id) => index.nodes.get(id)?.level ?? 0);
  let levelChanges = 0;
  for (let i = 1; i < levels.length; i++) if (levels[i] !== levels[i - 1]) levelChanges += 1;
  return {
    ok: true,
    legs: found.legs,
    nodes: found.nodes,
    summary: {
      seconds: Math.round(found.legs.reduce((s, l) => s + l.seconds, 0)),
      lengthM: Math.round(found.legs.reduce((s, l) => s + l.edge.lengthM, 0)),
      elevators: countElevatorRides(found.legs),
      levelChanges,
    },
    uncertainEdgeIds: found.uncertain,
  };
}

/** Separate elevator rides on a route: a ride's cab hops and shaft legs count once. */
export function countElevatorRides(legs: readonly RouteLeg[]): number {
  let rides = 0;
  legs.forEach((leg, i) => {
    if (leg.edge.mode === 'elevator' && legs[i - 1]?.edge.mode !== 'elevator') rides += 1;
  });
  return rides;
}

/** Exposed for tests: plain Dijkstra cost under a profile, to check A* against. */
export function dijkstraCost(
  index: GraphIndex,
  from: NodeId,
  to: NodeId,
  profile: ProfileId,
  outages: OutageIndex = NO_OUTAGES,
): number | undefined {
  return search(
    index,
    [from],
    [to],
    (arc) =>
      isBlocked(outages, arc.edge)
        ? { cost: Infinity, uncertain: false }
        : { cost: edgeCost(profile, arc.edge).cost, uncertain: false },
    false,
  )?.cost;
}
