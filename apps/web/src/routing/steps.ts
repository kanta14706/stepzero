/**
 * Turns a route into the steps a person follows: start, walks with turns, elevator rides, fare
 * gates, stairs or escalators, arrival. Pure and language-free: steps carry codes and numbers,
 * and the UI turns them into text (step 2.5, slice 2).
 *
 * What the data can and cannot support:
 * - Elevators have no names or numbers in the data, so a ride is described by the floors it
 *   connects and, for elevators that reach the street, the entrance it is at or near.
 * - Turns come from the angle between path segments. The heading is only known after a step
 *   with a direction (an elevator's exit hop, a fare gate, a previous walk), so the first walk
 *   from an entrance has no turn.
 * - Whether a fare gate is entered or left is inferred from where the route starts and ends.
 * - Unknown slope or step height is flagged per step (`uncertainEdgeIds`), never hidden.
 */
import type { GraphIndex } from './astar';
import { boardingPosition } from './boarding';
import type { BoardingPosition } from './boarding';
import type { GraphNode, NodeId, RouteLeg, RouteResult } from './types';

export type Turn = 'straight' | 'slight_left' | 'left' | 'slight_right' | 'right' | 'u_turn';

export type VerticalDirection = 'up' | 'down' | 'unknown';

/** Where a route starts or ends. */
export type Place =
  | { type: 'entrance'; nodeId: NodeId; label: string | null }
  /** An outside node with no entrance in the data (e.g. 新宿's step-free way in). */
  | { type: 'street'; nodeId: NodeId }
  | {
      type: 'platform';
      nodeId: NodeId;
      platformId: string | null;
      code: string | null;
      /** Front, middle or back of the train at this point; null when the data cannot say. */
      boarding: BoardingPosition | null;
    }
  | { type: 'other'; nodeId: NodeId; kind: GraphNode['kind'] };

/** What a walk leads to, so the text can say "… to the ticket gates". */
export type WalkTarget =
  'elevator' | 'fare_gate' | 'stairs' | 'escalator' | 'platform' | 'entrance' | 'street';

interface StepBase {
  /** Legs `legStart` to `legEnd - 1` of the route belong to this step. */
  legStart: number;
  legEnd: number;
  /** Whole floor (map panel) where the step starts; see `panelOf`. */
  panel: number;
  lengthM: number;
  seconds: number;
  /** Edges in this step whose slope or step height is unknown in the data. */
  uncertainEdgeIds: string[];
}

export type Step =
  | (StepBase & { kind: 'start'; place: Place })
  | (StepBase & {
      kind: 'walk';
      /** Relative to the direction the person is facing; null when that is not known. */
      turn: Turn | null;
      /** Set on the last walk before an elevator, gate, stairs or the destination. */
      target: WalkTarget | null;
      toPanel: number;
      /** Ramps on this stretch. `maxSlopePct` is the upper bound of the data's slope bucket. */
      ramps: { count: number; lengthM: number; maxSlopePct: number | null };
      movingWalkway: boolean;
      /** Lower bound of the narrowest known width bucket (0 means under 1 m). */
      narrowestWidthM: number | null;
    })
  | (StepBase & {
      kind: 'elevator';
      direction: VerticalDirection;
      fromLevel: number;
      toLevel: number;
      toPanel: number;
      /** The labelled entrance the elevator is at, or the nearest one within reach on the street. */
      entrance: { label: string; distanceM: number } | null;
    })
  | (StepBase & { kind: 'fare_gate'; direction: 'in' | 'out' | 'unknown' })
  | (StepBase & {
      kind: 'stairs' | 'escalator';
      direction: VerticalDirection;
      toPanel: number;
    })
  | (StepBase & { kind: 'arrive'; place: Place });

export type StepKind = Step['kind'];

/** Turns smaller than this are "straight on" and do not split a walk. */
const TURN_DEG = 30;
/** Corridor jogs shorter than this are folded into the next stretch instead of becoming a turn. */
const MIN_STRETCH_M = 6;
/** Douglas–Peucker tolerance for straightening a walked path, metres. */
const SIMPLIFY_M = 1.5;
/** A leg must move this far horizontally to tell which way someone is facing. */
const MIN_HEADING_M = 0.5;
/** A street elevator is "near" an entrance within this distance. */
const NEAR_ENTRANCE_M = 30;

/** The whole floor a graph level is shown on: half floors sit on the floor below. */
export const panelOf = (level: number): number => Math.floor(level);

interface Xy {
  x: number;
  y: number;
}

/** Local metres around a reference latitude; plenty for a station-sized area. */
function projector(lat0: number): (n: GraphNode) => Xy {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110540;
  return (n) => ({ x: n.lon * kx, y: n.lat * ky });
}

const dist = (a: Xy, b: Xy): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Compass bearing in degrees, clockwise from north. */
const bearing = (a: Xy, b: Xy): number => (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;

/** Signed change of direction in (-180, 180]; positive is to the right. */
function delta(from: number, to: number): number {
  let d = (to - from) % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}

export function classifyTurn(deg: number): Turn {
  const a = Math.abs(deg);
  if (a < TURN_DEG) return 'straight';
  if (a >= 150) return 'u_turn';
  if (a < 60) return deg > 0 ? 'slight_right' : 'slight_left';
  return deg > 0 ? 'right' : 'left';
}

/** Indices of the points kept by Douglas–Peucker. */
function simplify(points: Xy[], tolerance: number): number[] {
  if (points.length <= 2) return points.map((_, i) => i);
  const keep = new Set<number>([0, points.length - 1]);
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [i, j] = stack.pop() as [number, number];
    const a = points[i] as Xy;
    const b = points[j] as Xy;
    const len = dist(a, b);
    let worst = -1;
    let worstD = tolerance;
    for (let k = i + 1; k < j; k++) {
      const p = points[k] as Xy;
      const d =
        len === 0
          ? dist(a, p)
          : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
      if (d > worstD) {
        worstD = d;
        worst = k;
      }
    }
    if (worst > 0) {
      keep.add(worst);
      stack.push([i, worst], [worst, j]);
    }
  }
  return [...keep].sort((x, y) => x - y);
}

type Group = 'walk' | 'elevator' | 'fare_gate' | 'stairs' | 'escalator';

function groupOf(leg: RouteLeg): Group {
  switch (leg.edge.mode) {
    case 'walk':
    case 'ramp':
    case 'moving_walkway':
      return 'walk';
    default:
      return leg.edge.mode;
  }
}

function placeOf(n: GraphNode, index: GraphIndex): Place {
  switch (n.kind) {
    case 'entrance':
      return { type: 'entrance', nodeId: n.id, label: n.name?.['ja'] ?? null };
    case 'street':
      return { type: 'street', nodeId: n.id };
    case 'platform': {
      const platform = index.graph.station.platforms.find((p) => p.id === n.platformId);
      return {
        type: 'platform',
        nodeId: n.id,
        platformId: n.platformId ?? null,
        code: platform?.code ?? null,
        boarding: boardingPosition(index, n.platformId ?? null, n.id),
      };
    }
    default:
      return { type: 'other', nodeId: n.id, kind: n.kind };
  }
}

/** Steps for a found route. The legs of all steps together are exactly the route's legs, in order. */
export function routeToSteps(index: GraphIndex, route: Extract<RouteResult, { ok: true }>): Step[] {
  const { legs } = route;
  const nodeOf = (id: NodeId): GraphNode => {
    const n = index.nodes.get(id);
    if (!n) throw new Error(`route node ${id} is not in the graph`);
    return n;
  };
  const first = nodeOf(route.nodes[0] as NodeId);
  const last = nodeOf(route.nodes[route.nodes.length - 1] as NodeId);
  const xy = projector(first.lat);
  const uncertain = new Set(route.uncertainEdgeIds);

  const base = (start: number, end: number, at?: GraphNode): StepBase => {
    const slice = legs.slice(start, end);
    const from = at ?? nodeOf((slice[0] as RouteLeg).from);
    return {
      legStart: start,
      legEnd: end,
      panel: panelOf(from.level),
      lengthM: slice.reduce((s, l) => s + l.edge.lengthM, 0),
      seconds: slice.reduce((s, l) => s + l.seconds, 0),
      uncertainEdgeIds: slice.filter((l) => uncertain.has(l.edge.id)).map((l) => l.edge.id),
    };
  };

  /** Direction faced at the end of legs [start, end): the last leg that moves sideways enough. */
  const headingAfter = (start: number, end: number): number | null => {
    for (let i = end - 1; i >= start; i--) {
      const leg = legs[i] as RouteLeg;
      const a = xy(nodeOf(leg.from));
      const b = xy(nodeOf(leg.to));
      if (dist(a, b) >= MIN_HEADING_M) return bearing(a, b);
    }
    return null;
  };

  const vertical = (fromLevel: number, toLevel: number): VerticalDirection =>
    toLevel > fromLevel ? 'up' : toLevel < fromLevel ? 'down' : 'unknown';

  const startsOnPlatform = first.kind === 'platform';
  const endsOnPlatform = last.kind === 'platform';
  const gateDirection: 'in' | 'out' | 'unknown' =
    endsOnPlatform && !startsOnPlatform
      ? 'in'
      : startsOnPlatform && !endsOnPlatform
        ? 'out'
        : 'unknown';

  const labelledEntrances = index.graph.nodes.filter(
    (n) => n.kind === 'entrance' && n.name?.['ja'] !== undefined,
  );

  const steps: Step[] = [{ ...base(0, 0, first), kind: 'start', place: placeOf(first, index) }];
  let heading: number | null = null;

  // Split the legs into runs of the same group (walk, elevator ride, gate, stairs, escalator).
  const runs: { group: Group; start: number; end: number }[] = [];
  legs.forEach((leg, i) => {
    const group = groupOf(leg);
    const prev = runs[runs.length - 1];
    // Each fare gate is its own step; everything else merges with its neighbours.
    if (prev && prev.group === group && group !== 'fare_gate') prev.end = i + 1;
    else runs.push({ group, start: i, end: i + 1 });
  });

  runs.forEach((run, r) => {
    const runLegs = legs.slice(run.start, run.end);
    const fromNode = nodeOf((runLegs[0] as RouteLeg).from);
    const toNode = nodeOf((runLegs[runLegs.length - 1] as RouteLeg).to);
    const next = runs[r + 1];

    if (run.group === 'walk') {
      // Runs alternate, so the next run is never another walk.
      const target: WalkTarget | null =
        next && next.group !== 'walk'
          ? next.group
          : toNode.kind === 'platform' || toNode.kind === 'entrance' || toNode.kind === 'street'
            ? toNode.kind
            : null;
      for (const stretch of stretches(run.start, run.end)) {
        const stretchLegs = legs.slice(stretch.start, stretch.end);
        const a = xy(nodeOf((stretchLegs[0] as RouteLeg).from));
        const b = xy(nodeOf((stretchLegs[stretchLegs.length - 1] as RouteLeg).to));
        const direction = dist(a, b) >= MIN_HEADING_M ? bearing(a, b) : null;
        const ramps = stretchLegs.filter((l) => l.edge.mode === 'ramp');
        const knownSlopes = ramps.flatMap((l) =>
          l.edge.slopePct === undefined ? [] : [l.edge.slopePct],
        );
        const widths = stretchLegs.flatMap((l) =>
          l.edge.widthM === undefined ? [] : [l.edge.widthM],
        );
        steps.push({
          ...base(stretch.start, stretch.end),
          kind: 'walk',
          turn:
            heading !== null && direction !== null ? classifyTurn(delta(heading, direction)) : null,
          target: stretch.end === run.end ? target : null,
          toPanel: panelOf(nodeOf((stretchLegs[stretchLegs.length - 1] as RouteLeg).to).level),
          ramps: {
            count: ramps.length,
            lengthM: ramps.reduce((s, l) => s + l.edge.lengthM, 0),
            maxSlopePct: knownSlopes.length > 0 ? Math.max(...knownSlopes) : null,
          },
          movingWalkway: stretchLegs.some((l) => l.edge.mode === 'moving_walkway'),
          narrowestWidthM: widths.length > 0 ? Math.min(...widths) : null,
        });
        heading = headingAfter(stretch.start, stretch.end) ?? heading;
      }
      return;
    }

    const levels = [fromNode.level, ...runLegs.map((l) => nodeOf(l.to).level)];
    const direction = vertical(fromNode.level, toNode.level);
    const toPanel = panelOf(toNode.level);

    if (run.group === 'elevator') {
      steps.push({
        ...base(run.start, run.end),
        kind: 'elevator',
        direction,
        fromLevel: fromNode.level,
        toLevel: toNode.level,
        toPanel,
        entrance: elevatorEntrance(run.start, run.end, levels),
      });
    } else if (run.group === 'fare_gate') {
      steps.push({ ...base(run.start, run.end), kind: 'fare_gate', direction: gateDirection });
    } else {
      steps.push({ ...base(run.start, run.end), kind: run.group, direction, toPanel });
    }
    // Stairs, escalators and the vertical part of a ride have no useful heading; the exit hop
    // of an elevator and the passage through a gate do.
    heading = headingAfter(run.start, run.end) ?? heading;
  });

  steps.push({
    ...base(legs.length, legs.length, last),
    kind: 'arrive',
    place: placeOf(last, index),
  });
  return steps;

  /** Splits a walk run into straight-ish stretches at real turns. */
  function stretches(start: number, end: number): { start: number; end: number }[] {
    const points = [
      xy(nodeOf((legs[start] as RouteLeg).from)),
      ...legs.slice(start, end).map((l) => xy(nodeOf(l.to))),
    ];
    // Vertex v is the point after leg start + v - 1, so cuts are leg offsets.
    const cuts = simplify(points, SIMPLIFY_M);
    const parts = cuts.slice(0, -1).map((c, i) => ({ from: c, to: cuts[i + 1] as number }));
    const lengthOf = (p: { from: number; to: number }) =>
      dist(points[p.from] as Xy, points[p.to] as Xy);
    const dirOf = (p: { from: number; to: number }) =>
      bearing(points[p.from] as Xy, points[p.to] as Xy);

    // Fold short jogs into the following stretch (or the previous one at the end), then merge
    // neighbours that continue straight on. Repeat until nothing changes.
    for (let changed = true; changed && parts.length > 1;) {
      changed = false;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i] as { from: number; to: number };
        if (lengthOf(p) >= MIN_STRETCH_M) continue;
        if (i + 1 < parts.length) {
          const n = parts[i + 1] as { from: number; to: number };
          parts.splice(i, 2, { from: p.from, to: n.to });
        } else {
          const prev = parts[i - 1] as { from: number; to: number };
          parts.splice(i - 1, 2, { from: prev.from, to: p.to });
        }
        changed = true;
        break;
      }
      if (changed) continue;
      for (let i = 0; i + 1 < parts.length; i++) {
        const p = parts[i] as { from: number; to: number };
        const n = parts[i + 1] as { from: number; to: number };
        if (Math.abs(delta(dirOf(p), dirOf(n))) < TURN_DEG) {
          parts.splice(i, 2, { from: p.from, to: n.to });
          changed = true;
          break;
        }
      }
    }
    return parts.map((p) => ({ start: start + p.from, end: start + p.to }));
  }

  /** The entrance an elevator ride is at, or near if it reaches the street. */
  function elevatorEntrance(
    start: number,
    end: number,
    levels: number[],
  ): { label: string; distanceM: number } | null {
    const rideNodes = [
      nodeOf((legs[start] as RouteLeg).from),
      ...legs.slice(start, end).map((l) => nodeOf(l.to)),
    ];
    const at = rideNodes.find((n) => n.kind === 'entrance' && n.name?.['ja'] !== undefined);
    if (at) return { label: at.name?.['ja'] as string, distanceM: 0 };
    // Underground elevators are not described by a street entrance: it would point the wrong way.
    if (Math.max(...levels) < 0) return null;
    const top = rideNodes.reduce((a, b) => (b.level > a.level ? b : a));
    let best: { label: string; distanceM: number } | null = null;
    for (const e of labelledEntrances) {
      const d = dist(xy(top), xy(e));
      if (d <= NEAR_ENTRANCE_M && (best === null || d < best.distanceM)) {
        best = { label: e.name?.['ja'] as string, distanceM: Math.round(d) };
      }
    }
    return best;
  }
}
