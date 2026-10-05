import { useEffect, useState } from 'react';
import { RouterClient, createRouter } from '../../routing/client';
import type { WorkerLike } from '../../routing/client';
import type { NodeId, ProfileId, RouteResult, StationGraph } from '../../routing/types';

export interface RouteQuery {
  from: NodeId[];
  to: NodeId[];
  profile: ProfileId;
}

export type RouteState =
  { status: 'idle' } | { status: 'error' } | { status: 'ready'; result: RouteResult; ms: number };

/**
 * Loads the station graph into the router worker once, then re-routes whenever the query
 * changes. Answers that arrive after a newer query was sent are dropped.
 */
export function useStationRoute(
  graph: StationGraph,
  query: RouteQuery | null,
  createWorker: () => WorkerLike = createRouter,
): RouteState {
  // The router that has finished loading `graph`; a stale one is never used for another graph.
  const [loaded, setLoaded] = useState<{ client: RouterClient; graph: StationGraph } | null>(null);
  const [state, setState] = useState<RouteState>({ status: 'idle' });

  useEffect(() => {
    const c = new RouterClient(createWorker());
    let cancelled = false;
    c.load(graph).then(
      () => {
        if (!cancelled) setLoaded({ client: c, graph });
      },
      () => {
        if (!cancelled) setState({ status: 'error' });
      },
    );
    return () => {
      cancelled = true;
      c.dispose();
    };
  }, [graph, createWorker]);

  useEffect(() => {
    if (loaded?.graph !== graph || !query) return;
    const { client } = loaded;
    let cancelled = false;
    client.route({ stationId: graph.station.id, ...query }).then(
      ({ result, ms }) => {
        if (!cancelled) setState({ status: 'ready', result, ms });
      },
      () => {
        if (!cancelled) setState({ status: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [loaded, graph, query]);

  return state;
}
