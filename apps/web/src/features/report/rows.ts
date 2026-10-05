import type { OutageReport, OutageStatus } from '../../routing/types';

/** Columns of public.outage_reports the app reads (supabase/migrations, D-022). */
export const OUTAGE_COLUMNS =
  'id,edge_id,pathway_id,station_id,status,created_at,expires_at,confirmations,source';

const STATUSES: readonly OutageStatus[] = ['out_of_service', 'working', 'blocked', 'data_wrong'];
const SOURCES: readonly OutageReport['source'][] = ['community', 'operator'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * A database row (snake_case, as PostgREST and Realtime send it) as an OutageReport, or null
 * when the row is not one. Rows come from the network, so every field is checked.
 */
export function fromRow(row: unknown): OutageReport | null {
  if (!isRecord(row)) return null;
  const { id, edge_id, pathway_id, station_id, status, created_at, expires_at, confirmations } =
    row;
  const source = row['source'];
  if (
    typeof id !== 'string' ||
    typeof edge_id !== 'string' ||
    (pathway_id !== null && typeof pathway_id !== 'string') ||
    typeof station_id !== 'string' ||
    !STATUSES.includes(status as OutageStatus) ||
    typeof created_at !== 'string' ||
    typeof expires_at !== 'string' ||
    Number.isNaN(Date.parse(created_at)) ||
    Number.isNaN(Date.parse(expires_at)) ||
    typeof confirmations !== 'number' ||
    !SOURCES.includes(source as OutageReport['source'])
  ) {
    return null;
  }
  return {
    id,
    edgeId: edge_id,
    pathwayId: pathway_id,
    stationId: station_id,
    status: status as OutageStatus,
    createdAt: created_at,
    expiresAt: expires_at,
    confirmations,
    source: source as OutageReport['source'],
  };
}

export function fromRows(rows: unknown): OutageReport[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(fromRow).filter((r): r is OutageReport => r !== null);
}

/**
 * Merge reports into the current set, keyed by id (a later copy of a row replaces the earlier
 * one, e.g. a confirmation). `replace` starts from an empty set (a full reload). Reports that are
 * no longer active at `now` are dropped, so the set stays small during a long session.
 */
export function mergeReports(
  current: ReadonlyMap<string, OutageReport>,
  rows: readonly OutageReport[],
  replace: boolean,
  now: number,
): Map<string, OutageReport> {
  const next = new Map(replace ? [] : current);
  for (const r of rows) next.set(r.id, r);
  for (const [id, r] of next) {
    const expires = Date.parse(r.expiresAt);
    if (expires <= now || expires <= Date.parse(r.createdAt)) next.delete(id);
  }
  return next;
}

/** When the next of these reports expires (ms since epoch), or null when none is pending. */
export function nextExpiry(reports: Iterable<OutageReport>, now: number): number | null {
  let next: number | null = null;
  for (const r of reports) {
    const t = Date.parse(r.expiresAt);
    if (t > now && (next === null || t < next)) next = t;
  }
  return next;
}
