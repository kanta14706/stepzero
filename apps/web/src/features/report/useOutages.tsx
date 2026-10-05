import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { buildOutageIndex } from '../../routing/outages';
import type { OutageReport } from '../../routing/types';
import { mergeReports, nextExpiry } from './rows';
import { unavailableSource } from './source';
import type { CommunityStatus, LiveStatus, OutageSource } from './source';
import { createSupabaseSource, supabaseConfig } from './supabaseSource';

const OutageSourceContext = createContext<OutageSource | null>(null);

/** Test hook and composition point: which back end the app talks to. */
export function OutageSourceProvider({
  source,
  children,
}: {
  source: OutageSource;
  children: ReactNode;
}) {
  return <OutageSourceContext.Provider value={source}>{children}</OutageSourceContext.Provider>;
}

let defaultSource: OutageSource | null = null;

/** Supabase when the build has its URL and key, otherwise a source that says "unavailable". */
function getDefaultSource(): OutageSource {
  if (!defaultSource) {
    const config = supabaseConfig();
    defaultSource = config ? createSupabaseSource(config) : unavailableSource;
  }
  return defaultSource;
}

export function useOutageSource(): OutageSource {
  return useContext(OutageSourceContext) ?? getDefaultSource();
}

export interface Outages {
  status: LiveStatus;
  /** True once the station's full list has been loaded; changes after that are news. */
  loaded: boolean;
  /** Active reports for the station. */
  reports: OutageReport[];
  /** Edges out of service right now, sorted. */
  blockedEdgeIds: string[];
  /** Report a device; the answer is applied at once, without waiting for Realtime. */
  report: (edgeId: string, status: CommunityStatus) => Promise<OutageReport[]>;
}

export type StationOutages = Omit<Outages, 'report'>;

export interface ManyOutages {
  /** One entry per station asked for, in the order asked. */
  byStation: ReadonlyMap<string, StationOutages>;
  /** The weakest status: 'live' only when every station is live. */
  status: LiveStatus;
  /** True once every station's list has loaded. */
  loaded: boolean;
  report: Outages['report'];
}

// setTimeout overflows above 2^31 - 1 ms.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

interface StationState {
  reports: ReadonlyMap<string, OutageReport>;
  status: LiveStatus;
  loaded: boolean;
}

const EMPTY: StationState = { reports: new Map(), status: 'connecting', loaded: false };
const STATUS_ORDER: LiveStatus[] = ['unavailable', 'offline', 'connecting', 'live'];

/** Follows one station's outage reports, and drops each report when it expires. */
export function useOutages(stationId: string): Outages {
  const ids = useMemo(() => [stationId], [stationId]);
  const many = useOutagesFor(ids);
  const one = many.byStation.get(stationId);
  return {
    status: one?.status ?? 'connecting',
    loaded: one?.loaded ?? false,
    reports: one?.reports ?? NO_REPORTS,
    blockedEdgeIds: one?.blockedEdgeIds ?? NO_REPORTS_IDS,
    report: many.report,
  };
}

const NO_REPORTS: OutageReport[] = [];
const NO_REPORTS_IDS: string[] = [];

/**
 * Follows the outage reports of several stations (a journey's), and drops each report when it
 * expires. State is keyed by the set of stations, so reports of stations no longer asked for are
 * never shown.
 */
export function useOutagesFor(stationIds: readonly string[]): ManyOutages {
  const source = useOutageSource();
  const key = [...new Set(stationIds)].join('\n');
  const [state, setState] = useState<{ key: string; byStation: ReadonlyMap<string, StationState> }>(
    { key, byStation: new Map() },
  );
  const [now, setNow] = useState(() => Date.now());

  const update = useCallback(
    (stationId: string, change: (s: StationState) => StationState) => {
      setState((prev) => {
        const base = prev.key === key ? prev.byStation : new Map<string, StationState>();
        const next = new Map(base);
        next.set(stationId, change(base.get(stationId) ?? EMPTY));
        return { key, byStation: next };
      });
    },
    [key],
  );

  const apply = useCallback(
    (stationId: string, rows: OutageReport[], replace: boolean) => {
      const t = Date.now();
      setNow(t);
      update(stationId, (s) => ({
        ...s,
        reports: mergeReports(s.reports, rows, replace, t),
        loaded: s.loaded || replace,
      }));
    },
    [update],
  );

  useEffect(() => {
    if (!key) return;
    const stops = key.split('\n').map((stationId) =>
      source.watch(stationId, {
        onReports: (rows, replace) => {
          apply(stationId, rows, replace);
        },
        onStatus: (status) => {
          update(stationId, (s) => ({ ...s, status }));
        },
      }),
    );
    return () => {
      for (const stop of stops) stop();
    };
  }, [source, key, apply, update]);

  const current = state.key === key ? state.byStation : null;

  // Re-evaluate when the next report expires.
  useEffect(() => {
    if (!current) return;
    const next = nextExpiry(
      [...current.values()].flatMap((s) => [...s.reports.values()]),
      now,
    );
    if (next === null) return;
    const timer = setTimeout(
      () => {
        setNow(Date.now());
      },
      Math.min(next - now + 50, MAX_TIMEOUT_MS),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [current, now]);

  const byStation = useMemo(() => {
    const out = new Map<string, StationOutages>();
    for (const id of key ? key.split('\n') : []) {
      const s = current?.get(id) ?? EMPTY;
      const reports = [...s.reports.values()];
      out.set(id, {
        status: s.status,
        loaded: s.loaded,
        reports,
        blockedEdgeIds: [...buildOutageIndex(reports, new Date(now)).blockedEdgeIds].sort(),
      });
    }
    return out;
  }, [key, current, now]);

  const report = useCallback(
    async (edgeId: string, status: CommunityStatus) => {
      const rows = await source.report(edgeId, status);
      const watched = new Set(key.split('\n'));
      const groups = new Map<string, OutageReport[]>();
      for (const r of rows) {
        if (watched.has(r.stationId))
          groups.set(r.stationId, [...(groups.get(r.stationId) ?? []), r]);
      }
      for (const [stationId, list] of groups) apply(stationId, list, false);
      return rows;
    },
    [source, key, apply],
  );

  const all = [...byStation.values()];
  const status = all.length
    ? all.reduce<LiveStatus>(
        (worst, s) =>
          STATUS_ORDER.indexOf(s.status) < STATUS_ORDER.indexOf(worst) ? s.status : worst,
        'live',
      )
    : 'connecting';
  return { byStation, status, loaded: all.length > 0 && all.every((s) => s.loaded), report };
}
