import { loadStationGraph } from '../../map/data';
import type { OutageReport } from '../../routing/types';
import { indexDevices } from './devices';
import { ReportError } from './source';
import type { CommunityStatus, OutageSource, WatchHandlers } from './source';

/**
 * Reports made without a connection (step 2.9, D-025). They are kept on the device, applied to
 * this device's routes at once as `pending` reports, and sent when the connection is back. The
 * back end dates a report when it receives it, so a queued report older than this is dropped
 * rather than sent: an hour-old "out of service" would otherwise count as fresh for six hours.
 */
export const QUEUE_MAX_AGE_MS = 60 * 60 * 1000;
/** A report the back end keeps refusing (other than for being offline) is dropped after this. */
const MAX_ATTEMPTS = 5;

export interface QueuedReport {
  /** The edge reported (the back end expands it to its device). */
  edgeId: string;
  /** Every edge of the device, so the pending report blocks the whole lift or escalator. */
  edgeIds: string[];
  stationId: string;
  status: CommunityStatus;
  queuedAt: string;
  attempts: number;
}

export interface QueueStore {
  read(): QueuedReport[];
  write(queue: QueuedReport[]): void;
}

function isQueued(x: unknown): x is QueuedReport {
  if (typeof x !== 'object' || x === null) return false;
  const q = x as Record<string, unknown>;
  return (
    typeof q['edgeId'] === 'string' &&
    Array.isArray(q['edgeIds']) &&
    q['edgeIds'].every((e) => typeof e === 'string') &&
    typeof q['stationId'] === 'string' &&
    (q['status'] === 'out_of_service' || q['status'] === 'working') &&
    typeof q['queuedAt'] === 'string' &&
    !Number.isNaN(Date.parse(q['queuedAt'])) &&
    typeof q['attempts'] === 'number'
  );
}

/** The queue in localStorage; in memory when storage is blocked (private mode, tests). */
export function localQueueStore(key = 'stepzero.reportQueue'): QueueStore {
  let memory: QueuedReport[] = [];
  return {
    read() {
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) return memory;
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(isQueued) : [];
      } catch {
        return memory;
      }
    },
    write(queue) {
      memory = queue;
      try {
        if (queue.length) localStorage.setItem(key, JSON.stringify(queue));
        else localStorage.removeItem(key);
      } catch {
        // Kept in memory only.
      }
    },
  };
}

/** Edge ids start with their station id ("421:hokonavi:…"). */
export function stationOfEdge(edgeId: string): string {
  return edgeId.split(':')[0] ?? edgeId;
}

/**
 * The queued report as one pending row per edge of its device. `ended` gives the same rows with
 * `expiresAt` equal to `createdAt`, which makes the merge drop them (rows.ts, mergeReports).
 */
export function pendingRows(q: QueuedReport, ended = false): OutageReport[] {
  const expiresAt = ended
    ? q.queuedAt
    : new Date(Date.parse(q.queuedAt) + QUEUE_MAX_AGE_MS).toISOString();
  return q.edgeIds.map((edgeId) => ({
    id: `queued:${edgeId}`,
    pathwayId: null,
    edgeId,
    stationId: q.stationId,
    status: q.status,
    createdAt: q.queuedAt,
    expiresAt,
    confirmations: 0,
    source: 'community',
    pending: true,
  }));
}

const overlaps = (a: QueuedReport, b: QueuedReport): boolean =>
  a.edgeIds.some((id) => b.edgeIds.includes(id));
const same = (a: QueuedReport, b: QueuedReport): boolean =>
  a.edgeId === b.edgeId && a.queuedAt === b.queuedAt;

/** The edges of the device an edge belongs to, from the station graph (precached offline). */
export function graphDeviceEdges(): (edgeId: string) => Promise<string[]> {
  const byStation = new Map<string, Promise<ReturnType<typeof indexDevices>>>();
  return async (edgeId) => {
    const stationId = stationOfEdge(edgeId);
    let p = byStation.get(stationId);
    if (!p) {
      p = loadStationGraph(stationId).then(indexDevices);
      p.catch(() => byStation.delete(stationId));
      byStation.set(stationId, p);
    }
    try {
      return (await p).byEdge.get(edgeId)?.edgeIds ?? [edgeId];
    } catch {
      return [edgeId];
    }
  };
}

export interface QueueOptions {
  store?: QueueStore;
  isOnline?: () => boolean;
  deviceEdges?: (edgeId: string) => Promise<string[]>;
  now?: () => number;
  /** Where the 'online' event comes from; null to flush only on demand (tests). */
  events?: Pick<Window, 'addEventListener'> | null;
}

export interface QueuedSource extends OutageSource {
  /** Send what is queued. Resolves when done or when the connection fails again. */
  flush(): Promise<void>;
}

const browserOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine;

/**
 * Wraps a source so that reports made offline are queued instead of failing. Watchers of a
 * station see its pending reports, also after a full reload of the station's reports.
 */
export function createQueuedSource(inner: OutageSource, options: QueueOptions = {}): QueuedSource {
  const store = options.store ?? localQueueStore();
  const isOnline = options.isOnline ?? browserOnline;
  const deviceEdges = options.deviceEdges ?? graphDeviceEdges();
  const now = options.now ?? Date.now;
  const watchers = new Map<string, Set<WatchHandlers>>();

  const fresh = (q: QueuedReport): boolean => now() - Date.parse(q.queuedAt) < QUEUE_MAX_AGE_MS;
  const pendingFor = (stationId: string): OutageReport[] =>
    store
      .read()
      .filter((q) => q.stationId === stationId && fresh(q))
      .flatMap((q) => pendingRows(q));
  const notify = (stationId: string, rows: OutageReport[]): void => {
    for (const h of watchers.get(stationId) ?? []) h.onReports(rows, false);
  };

  async function enqueue(edgeId: string, status: CommunityStatus): Promise<OutageReport[]> {
    const item: QueuedReport = {
      edgeId,
      edgeIds: await deviceEdges(edgeId),
      stationId: stationOfEdge(edgeId),
      status,
      queuedAt: new Date(now()).toISOString(),
      attempts: 0,
    };
    // The latest report on a device replaces an earlier queued one.
    store.write([...store.read().filter((q) => !overlaps(q, item)), item]);
    const rows = pendingRows(item);
    notify(item.stationId, rows);
    return rows;
  }

  let flushing: Promise<void> | null = null;
  async function sendAll(): Promise<void> {
    for (const item of store.read()) {
      if (!isOnline()) return;
      // Take the item off the queue before sending, so a second tab does not send it too.
      if (!store.read().some((q) => same(q, item))) continue;
      store.write(store.read().filter((q) => !same(q, item)));
      if (!fresh(item)) {
        notify(item.stationId, pendingRows(item, true));
        continue;
      }
      try {
        const rows = await inner.report(item.edgeId, item.status);
        notify(item.stationId, [...pendingRows(item, true), ...rows]);
      } catch (e) {
        const code = e instanceof ReportError ? e.code : 'failed';
        const retry = code !== 'not_reportable' && item.attempts + 1 < MAX_ATTEMPTS;
        const current = store.read();
        if (retry && !current.some((q) => overlaps(q, item))) {
          store.write([{ ...item, attempts: item.attempts + 1 }, ...current]);
        } else if (!retry) {
          notify(item.stationId, pendingRows(item, true));
        }
        // Offline again or told to slow down: try the rest later.
        if (code === 'offline' || code === 'rate_limited') return;
      }
    }
  }
  const flush = (): Promise<void> => {
    if (!isOnline() || store.read().length === 0) return Promise.resolve();
    flushing ??= sendAll().finally(() => {
      flushing = null;
    });
    return flushing;
  };

  const events =
    options.events === undefined && typeof window !== 'undefined' ? window : options.events;
  events?.addEventListener('online', () => {
    void flush();
  });
  // Reports queued in an earlier visit.
  queueMicrotask(() => {
    void flush();
  });

  return {
    flush,
    watch(stationId, handlers) {
      let set = watchers.get(stationId);
      if (!set) watchers.set(stationId, (set = new Set()));
      set.add(handlers);
      const stop = inner.watch(stationId, {
        onReports: (rows, replace) => {
          handlers.onReports(replace ? [...rows, ...pendingFor(stationId)] : rows, replace);
        },
        onStatus: (status) => {
          handlers.onStatus(status);
          if (status === 'live') void flush();
        },
      });
      const pending = pendingFor(stationId);
      if (pending.length) handlers.onReports(pending, false);
      return () => {
        set.delete(handlers);
        stop();
      };
    },
    async report(edgeId, status) {
      if (isOnline()) {
        try {
          return await inner.report(edgeId, status);
        } catch (e) {
          if (!(e instanceof ReportError && e.code === 'offline')) throw e;
        }
      }
      return enqueue(edgeId, status);
    },
  };
}

/** True when a report's answer is only the pending copy kept on this device. */
export const isQueuedAnswer = (rows: readonly OutageReport[]): boolean =>
  rows.length > 0 && rows.every((r) => r.pending === true);
