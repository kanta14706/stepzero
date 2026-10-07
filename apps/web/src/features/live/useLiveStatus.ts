import { useEffect, useMemo, useState } from 'react';
import type { RideLeg } from '../journey/types';
import { supabaseConfig } from '../report/supabaseSource';
import type { SupabaseConfig } from '../report/supabaseSource';
import { LiveFetchError, OPERATOR_BY_FEED, fetchLive } from './api';
import { alertsFor, computeLegLive, legKey } from './delay';
import type { FeedState, LegLive, LiveAlert, LiveResponse } from './types';

/** How often the live times are asked for again while the journey is on screen. */
export const POLL_MS = 30_000;

export type LiveFetch = (
  operator: string,
  tripIds: string[],
  signal: AbortSignal,
) => Promise<LiveResponse>;

export interface LiveStatusOptions {
  /** Test hook: replaces the call to the edge function. */
  fetchLive?: LiveFetch;
  config?: SupabaseConfig | null;
  intervalMs?: number;
  isOnline?: () => boolean;
  now?: () => number;
}

export interface JourneyLive {
  byLeg: ReadonlyMap<string, LegLive>;
  /** Alerts that concern each leg, active now. */
  alerts: ReadonlyMap<string, LiveAlert[]>;
  /** When the latest answer arrived (ISO), or null. */
  updatedAt: string | null;
  /** True when the journey has a train the feeds cover (so live status can be shown at all). */
  covered: boolean;
}

type Answer =
  | { kind: 'ok'; response: LiveResponse; at: number }
  | { kind: 'error'; code: 'unavailable' | 'not_configured' };

const browserOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine;

const operatorOf = (leg: RideLeg): string | null =>
  (leg.live ? OPERATOR_BY_FEED[leg.live.feedId] : undefined) ?? null;

/**
 * Live delays and alerts for the trains of the journey on screen (D-027). Asks the edge function
 * once per operator now and then every 30 s while the page is visible; says why when it cannot.
 */
export function useLiveStatus(
  legs: readonly RideLeg[],
  options: LiveStatusOptions = {},
): JourneyLive {
  const {
    config = supabaseConfig(),
    intervalMs = POLL_MS,
    isOnline = browserOnline,
    now = Date.now,
  } = options;
  const fetcher = useMemo<LiveFetch | null>(
    () =>
      options.fetchLive ??
      (config ? (op, ids, signal) => fetchLive(config, op, ids, signal) : null),
    [options.fetchLive, config],
  );

  // Trips to ask for, per operator. Keyed by content so a new array of the same legs is no change.
  const asked = useMemo(() => {
    const byOperator = new Map<string, Set<string>>();
    for (const leg of legs) {
      const op = operatorOf(leg);
      if (op && leg.live) {
        const set = byOperator.get(op) ?? new Set<string>();
        set.add(leg.live.tripId);
        byOperator.set(op, set);
      }
    }
    return new Map([...byOperator].map(([op, ids]) => [op, [...ids].sort()]));
  }, [legs]);
  const askedKey = [...asked].map(([op, ids]) => `${op}:${ids.join(',')}`).join(';');
  // The same trains in a new array are no change: keep polling instead of starting over.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableAsked = useMemo(() => asked, [askedKey]);

  const [answers, setAnswers] = useState<{ key: string; byOperator: Map<string, Answer> }>({
    key: '',
    byOperator: new Map(),
  });
  const [online, setOnline] = useState(isOnline());

  useEffect(() => {
    const up = (): void => {
      setOnline(true);
    };
    const down = (): void => {
      setOnline(false);
    };
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  useEffect(() => {
    if (!fetcher || !online || stableAsked.size === 0) return;
    const controller = new AbortController();
    const key = askedKey;
    const poll = async (): Promise<void> => {
      const results = await Promise.all(
        [...stableAsked].map(async ([op, ids]): Promise<[string, Answer]> => {
          try {
            return [
              op,
              { kind: 'ok', response: await fetcher(op, ids, controller.signal), at: now() },
            ];
          } catch (e) {
            const code = e instanceof LiveFetchError ? e.code : 'unavailable';
            return [op, { kind: 'error', code }];
          }
        }),
      );
      if (!controller.signal.aborted) setAnswers({ key, byOperator: new Map(results) });
    };
    void poll();
    const timer = setInterval(() => {
      if (!document.hidden) void poll();
    }, intervalMs);
    const onVisible = (): void => {
      if (!document.hidden) void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetcher, online, stableAsked, askedKey, intervalMs, now]);

  return useMemo(() => {
    const current = answers.key === askedKey ? answers.byOperator : new Map<string, Answer>();
    const byLeg = new Map<string, LegLive>();
    const alerts = new Map<string, LiveAlert[]>();
    let updatedAt: number | null = null;
    let covered = false;
    for (const leg of legs) {
      const op = operatorOf(leg);
      let feed: FeedState;
      let response: LiveResponse | null = null;
      if (!op) feed = 'not_covered';
      else {
        covered = true;
        const a = current.get(op);
        if (!fetcher) feed = 'not_configured';
        else if (!online) feed = 'offline';
        else if (!a) feed = 'loading';
        else if (a.kind === 'error') feed = a.code;
        else {
          response = a.response;
          feed = a.response.status;
          updatedAt = Math.max(updatedAt ?? 0, a.at);
        }
      }
      byLeg.set(legKey(leg), computeLegLive(leg, feed, response));
      if (response) alerts.set(legKey(leg), alertsFor(leg, response.alerts, now() / 1000));
    }
    return {
      byLeg,
      alerts,
      updatedAt: updatedAt === null ? null : new Date(updatedAt).toISOString(),
      covered,
    };
  }, [legs, answers, askedKey, fetcher, online, now]);
}
