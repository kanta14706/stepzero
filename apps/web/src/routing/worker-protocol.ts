import { findRoute, indexGraph } from './astar';
import type { GraphIndex } from './astar';
import { NO_OUTAGES } from './outages';
import type { NodeId, ProfileId, RouteResult, StationGraph } from './types';

/** Messages between the UI thread and the router worker. Plain data only (structured clone). */
export type WorkerRequest =
  | { type: 'load'; id: number; graph: StationGraph }
  | {
      type: 'route';
      id: number;
      stationId: string;
      from: NodeId[];
      to: NodeId[];
      profile: ProfileId;
      /** Edge and pathway ids that are out of service right now. */
      blockedEdgeIds?: string[];
      blockedPathwayIds?: string[];
      /** Street cost of starting or ending at a node (EndCosts in astar.ts). */
      fromCost?: Record<NodeId, number>;
      toCost?: Record<NodeId, number>;
    };

export type WorkerResponse =
  | { type: 'loaded'; id: number; stationId: string }
  | { type: 'route'; id: number; result: RouteResult; ms: number }
  | { type: 'error'; id: number; message: string };

/** The worker's state: one adjacency index per loaded station. */
export type WorkerState = Map<string, GraphIndex>;

/** Pure message handler, so it can be tested without a real Worker. */
export function handleMessage(
  state: WorkerState,
  msg: WorkerRequest,
  now: () => number = () => performance.now(),
): WorkerResponse {
  if (msg.type === 'load') {
    state.set(msg.graph.station.id, indexGraph(msg.graph));
    return { type: 'loaded', id: msg.id, stationId: msg.graph.station.id };
  }
  const index = state.get(msg.stationId);
  if (!index) {
    return { type: 'error', id: msg.id, message: `station ${msg.stationId} is not loaded` };
  }
  const outages =
    msg.blockedEdgeIds?.length || msg.blockedPathwayIds?.length
      ? {
          blockedEdgeIds: new Set(msg.blockedEdgeIds ?? []),
          blockedPathwayIds: new Set(msg.blockedPathwayIds ?? []),
        }
      : NO_OUTAGES;
  const t0 = now();
  const result = findRoute(index, {
    from: msg.from,
    to: msg.to,
    profile: msg.profile,
    outages,
    ...(msg.fromCost && { fromCost: msg.fromCost }),
    ...(msg.toCost && { toCost: msg.toCost }),
  });
  return { type: 'route', id: msg.id, result, ms: now() - t0 };
}
