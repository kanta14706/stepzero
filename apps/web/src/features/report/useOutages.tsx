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

// setTimeout overflows above 2^31 - 1 ms.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** Follows one station's outage reports, and drops each report when it expires. */
export function useOutages(stationId: string): Outages {
  const source = useOutageSource();
  // Keyed by station, so a previous station's reports never show for a new one.
  const [state, setState] = useState<{
    stationId: string;
    reports: ReadonlyMap<string, OutageReport>;
    status: LiveStatus;
    loaded: boolean;
  }>({ stationId, reports: new Map(), status: 'connecting', loaded: false });
  const [now, setNow] = useState(() => Date.now());

  const apply = useCallback(
    (rows: OutageReport[], replace: boolean) => {
      const t = Date.now();
      setNow(t);
      setState((s) => {
        const current =
          s.stationId === stationId ? s : { ...s, stationId, reports: new Map(), loaded: false };
        return {
          ...current,
          reports: mergeReports(current.reports, rows, replace, t),
          loaded: current.loaded || replace,
        };
      });
    },
    [stationId],
  );

  useEffect(
    () =>
      source.watch(stationId, {
        onReports: apply,
        onStatus: (status) => {
          setState((s) =>
            s.stationId === stationId
              ? { ...s, status }
              : { stationId, reports: new Map(), status, loaded: false },
          );
        },
      }),
    [source, stationId, apply],
  );

  const current = state.stationId === stationId ? state : null;
  const reports = current?.reports;

  // Re-evaluate when the next report expires.
  useEffect(() => {
    if (!reports) return;
    const next = nextExpiry(reports.values(), now);
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
  }, [reports, now]);

  const list = useMemo(() => [...(reports?.values() ?? [])], [reports]);
  const blockedEdgeIds = useMemo(
    () => [...buildOutageIndex(list, new Date(now)).blockedEdgeIds].sort(),
    [list, now],
  );

  const report = useCallback(
    async (edgeId: string, status: CommunityStatus) => {
      const rows = await source.report(edgeId, status);
      apply(rows, false);
      return rows;
    },
    [source, apply],
  );

  return {
    status: current?.status ?? 'connecting',
    loaded: current?.loaded ?? false,
    reports: list,
    blockedEdgeIds,
    report,
  };
}
