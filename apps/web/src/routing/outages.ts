import type { GraphEdge, OutageReport } from './types';

/** Edge ids (and pathway ids) that are currently out of service, from the active reports. */
export interface OutageIndex {
  blockedEdgeIds: ReadonlySet<string>;
  blockedPathwayIds: ReadonlySet<string>;
}

export const NO_OUTAGES: OutageIndex = {
  blockedEdgeIds: new Set(),
  blockedPathwayIds: new Set(),
};

/**
 * Build the outage index. Reports expire at `expiresAt`. For each edge the newest active
 * report decides: `out_of_service` and `blocked` block it, `working` clears it, and
 * `data_wrong` is not an outage (it feeds the data-quality loop instead). A report the server
 * ended because a newer status replaced it has `expiresAt` equal to `createdAt` (D-022); it is
 * skipped whatever the device clock says.
 */
export function buildOutageIndex(reports: readonly OutageReport[], now: Date): OutageIndex {
  const newest = new Map<string, OutageReport>();
  for (const r of reports) {
    const expires = new Date(r.expiresAt).getTime();
    if (expires <= now.getTime() || expires <= new Date(r.createdAt).getTime()) continue;
    const key = r.edgeId;
    const prev = newest.get(key);
    if (!prev || new Date(r.createdAt).getTime() >= new Date(prev.createdAt).getTime()) {
      newest.set(key, r);
    }
  }
  const blockedEdgeIds = new Set<string>();
  const blockedPathwayIds = new Set<string>();
  for (const r of newest.values()) {
    if (r.status === 'out_of_service' || r.status === 'blocked') {
      blockedEdgeIds.add(r.edgeId);
      if (r.pathwayId) blockedPathwayIds.add(r.pathwayId);
    }
  }
  return { blockedEdgeIds, blockedPathwayIds };
}

export function isBlocked(index: OutageIndex, edge: GraphEdge): boolean {
  return (
    index.blockedEdgeIds.has(edge.id) ||
    (edge.pathwayId !== undefined && index.blockedPathwayIds.has(edge.pathwayId))
  );
}
