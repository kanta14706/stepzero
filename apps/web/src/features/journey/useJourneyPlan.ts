import { useEffect, useMemo, useRef, useState } from 'react';
import { indexGraph } from '../../routing/astar';
import type { GraphIndex } from '../../routing/astar';
import { RouterClient, createRouter } from '../../routing/client';
import type { WorkerLike } from '../../routing/client';
import { loadStationGraph } from '../../map/data';
import type { LiveStatusOptions } from '../live/useLiveStatus';
import { useOutagesFor } from '../report/useOutages';
import type { ManyOutages } from '../report/useOutages';
import { assembleAll } from './assemble';
import type { AssembleDeps, Planned } from './assemble';
import { PlanError, planTrains, planWalk } from './otp';
import type { PlanErrorCode, PlanTrainsInput } from './otp';
import { defaultPlanStore, planKey, savedPlan } from './saved';
import type { PlanStore, SavedPlan, WalkAnswer } from './saved';
import type { Itinerary, Journey, JourneyRequest, Station } from './types';

/** When no train can be caught from the requested time, ask again this much later (once). */
const RETRY_LATER_S = 15 * 60;

/** 'offline': no connection and no saved plan for this trip. */
export type JourneyErrorCode = PlanErrorCode | 'failed' | 'offline';

export type JourneyPlanState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; code: JourneyErrorCode }
  | {
      status: 'ready';
      request: JourneyRequest;
      planned: Planned;
      /** The outage reports the plan took into account, per station (sorted edge ids). */
      blockedKey: string;
      /** Set when OTP could not be reached and the plan is the one saved on the device. */
      saved: { savedAt: string; time: string } | null;
    };

export interface JourneyPlanOptions {
  plan?: (input: PlanTrainsInput, signal: AbortSignal) => Promise<Itinerary[]>;
  walk?: AssembleDeps['walk'];
  createWorker?: () => WorkerLike;
  loadGraph?: (id: string) => Promise<GraphIndex>;
  /** Where the last plan is kept for offline use (D-025). */
  store?: PlanStore;
  isOnline?: () => boolean;
  /** Live train status (step 2.7): test hooks for the edge function call and the clock. */
  live?: LiveStatusOptions;
}

const browserOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine;

const graphCache = new Map<string, Promise<GraphIndex>>();
function loadIndex(id: string): Promise<GraphIndex> {
  let p = graphCache.get(id);
  if (!p) {
    p = loadStationGraph(id).then(indexGraph);
    p.catch(() => graphCache.delete(id));
    graphCache.set(id, p);
  }
  return p;
}

/** Stations on any candidate itinerary that have full detail, so their outages are followed. */
function detailedStations(itineraries: readonly Itinerary[], tier2: ReadonlySet<string>): string[] {
  const ids = new Set<string>();
  for (const it of itineraries) {
    for (const leg of it.legs) {
      for (const id of [leg.from.stationId, leg.to.stationId]) if (id && tier2.has(id)) ids.add(id);
    }
  }
  return [...ids].sort();
}

const addSeconds = (iso: string, s: number): string =>
  new Date(Date.parse(iso) + s * 1000).toISOString();

/** A key that changes when the route of a journey changes (not when only counts change). */
export function journeyKey(j: Journey): string {
  return j.segments
    .map((s) =>
      s.kind === 'station'
        ? s.tier === 2
          ? s.route.legs.map((l) => l.edge.id).join(',')
          : s.stationId
        : s.kind === 'ride'
          ? `${s.leg.route.id}@${s.leg.departure}`
          : s.kind,
    )
    .join('|');
}

/**
 * Plans a journey: train itineraries from OTP once per request, then the stations along them
 * with the in-station router, again whenever an outage report changes what is blocked.
 */
export function useJourneyPlan(
  request: JourneyRequest | null,
  stations: readonly Station[],
  options: JourneyPlanOptions = {},
): { state: JourneyPlanState; outages: ManyOutages } {
  const {
    plan,
    walk,
    createWorker = createRouter,
    loadGraph = loadIndex,
    store = defaultPlanStore,
    isOnline = browserOnline,
  } = options;
  const tier2 = useMemo(
    () => new Set(stations.filter((s) => s.tier === 2).map((s) => s.id)),
    [stations],
  );

  // 1. Train itineraries for the request.
  const [trains, setTrains] = useState<
    | {
        request: JourneyRequest;
        itineraries: Itinerary[];
        retried: boolean;
        saved: SavedPlan | null;
      }
    | { request: JourneyRequest; error: JourneyErrorCode }
    | null
  >(null);
  const [retryAt, setRetryAt] = useState<{ request: JourneyRequest; time: string } | null>(null);

  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    const time = retryAt?.request === request ? retryAt.time : request.time;
    const input = { from: request.from, to: request.to, time, profile: request.profile };
    // Without a connection, the plan saved for the same trip (any time) stands in for OTP.
    const fromSaved = (): boolean => {
      const saved = store.load();
      if (saved?.key !== planKey(request)) return false;
      setTrains({ request, itineraries: saved.itineraries, retried: true, saved });
      return true;
    };
    // Offline, OTP is not asked at all (a request could hang on a weak signal).
    const answer = !isOnline()
      ? Promise.reject(new PlanError('unavailable'))
      : plan
        ? plan(input, controller.signal)
        : planTrains(input, { signal: controller.signal });
    answer.then(
      (itineraries) => {
        if (!controller.signal.aborted)
          setTrains({ request, itineraries, retried: time !== request.time, saved: null });
      },
      (e: unknown) => {
        if (controller.signal.aborted) return;
        const code = e instanceof PlanError ? e.code : 'failed';
        if (code === 'unavailable' && fromSaved()) return;
        setTrains({ request, error: code === 'unavailable' && !isOnline() ? 'offline' : code });
      },
    );
    return () => {
      controller.abort();
    };
  }, [request, retryAt, plan, store, isOnline]);

  const current = trains && trains.request === request ? trains : null;
  const itineraries = current && 'itineraries' in current ? current.itineraries : null;
  const watched = useMemo(
    () => (itineraries ? detailedStations(itineraries, tier2) : []),
    [itineraries, tier2],
  );
  const outages = useOutagesFor(watched);
  const blockedKey = watched
    .map((id) => `${id}:${(outages.byStation.get(id)?.blockedEdgeIds ?? []).join(',')}`)
    .join(';');

  // 2. The in-station router, one worker for every station of the journey, made on first use.
  const routerRef = useRef<{ client: RouterClient; loaded: Map<string, Promise<void>> } | null>(
    null,
  );
  useEffect(
    () => () => {
      routerRef.current?.client.dispose();
      routerRef.current = null;
    },
    [createWorker],
  );

  // 3. Assemble, again whenever the blocked edges change.
  const [assembled, setAssembled] = useState<JourneyPlanState>({ status: 'idle' });
  useEffect(() => {
    if (!request || !itineraries || !current || !('itineraries' in current)) return;
    let cancelled = false;
    routerRef.current ??= { client: new RouterClient(createWorker()), loaded: new Map() };
    const router = routerRef.current;
    const blocked: Record<string, string[]> = {};
    for (const id of watched) blocked[id] = outages.byStation.get(id)?.blockedEdgeIds ?? [];
    const saved = current.saved;
    // A saved plan is assembled for the time it was made for, with the walks it had then.
    const planRequest = saved ? { ...request, time: saved.time } : request;
    const walks = new Map<string, Promise<WalkAnswer>>(
      saved?.walks.map(([k, w]) => [k, Promise.resolve(w)]),
    );
    const deps: AssembleDeps = {
      graph: async (id) => (tier2.has(id) ? loadGraph(id).catch(() => null) : null),
      route: async (id, q) => {
        let ready = router.loaded.get(id);
        if (!ready) {
          ready = loadGraph(id).then((g) => router.client.load(g.graph));
          router.loaded.set(id, ready);
        }
        await ready;
        return (await router.client.route({ stationId: id, ...q })).result;
      },
      walk: (from, to) => {
        const key = [from.lat, from.lon, to.lat, to.lon].join();
        let w = walks.get(key);
        if (!w) {
          w = saved
            ? Promise.resolve(null)
            : walk
              ? walk(from, to)
              : planWalk(from, to, request.time, request.profile).catch(() => null);
          walks.set(key, w);
        }
        return w;
      },
    };
    assembleAll(itineraries, { request: planRequest, blocked }, deps).then(
      (planned) => {
        if (cancelled) return;
        // Every train leaves too soon to be caught: ask OTP again a little later, once.
        if (planned.journeys.length === 0 && planned.rejections.length === 0 && !current.retried) {
          setRetryAt({ request, time: addSeconds(request.time, RETRY_LATER_S) });
          return;
        }
        setAssembled({
          status: 'ready',
          request,
          planned,
          blockedKey,
          saved: saved ? { savedAt: saved.savedAt, time: saved.time } : null,
        });
        // Keep OTP's answer for offline use: the walks are all settled once assembly is done.
        if (!saved && planned.journeys.length > 0) {
          void Promise.all(
            [...walks].map(async ([k, w]): Promise<[string, WalkAnswer]> => [k, await w]),
          ).then((settled) => {
            store.save(savedPlan(request, itineraries, settled));
          });
        }
      },
      () => {
        if (!cancelled) setAssembled({ status: 'error', code: 'failed' });
      },
    );
    return () => {
      cancelled = true;
    };
    // blockedKey stands for the contents of outages.byStation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, itineraries, blockedKey, tier2, loadGraph, walk, createWorker, store]);

  let state: JourneyPlanState;
  if (!request) state = { status: 'idle' };
  else if (current && 'error' in current) state = { status: 'error', code: current.error };
  else if (assembled.status === 'ready' && assembled.request === request) state = assembled;
  else if (assembled.status === 'error' && current) state = assembled;
  else state = { status: 'loading' };
  return { state, outages };
}
