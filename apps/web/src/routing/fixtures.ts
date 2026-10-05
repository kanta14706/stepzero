import type { EdgeMode, GraphEdge, GraphNode, NodeKind, StationGraph } from './types';

/** Small hand-made graphs for unit tests. Real-data tests live in golden.test.ts. */

export function node(
  id: string,
  kind: NodeKind = 'junction',
  level = 0,
  lon = 139,
  lat = 35,
): GraphNode {
  return { id, lon, lat, level, kind, stationId: 'T' };
}

export function edge(
  id: string,
  from: string,
  to: string,
  mode: EdgeMode,
  extra: Partial<GraphEdge> = {},
): GraphEdge {
  return {
    id,
    from,
    to,
    mode,
    lengthM: 10,
    seconds: 10,
    slopePct: 0,
    stepHeightCm: 0,
    widthM: 2,
    bidirectional: true,
    ...extra,
  };
}

export function graph(nodes: GraphNode[], edges: GraphEdge[]): StationGraph {
  return {
    schemaVersion: 1,
    station: {
      id: 'T',
      slug: 't',
      name: { ja: 'テスト' },
      levels: [],
      bbox: [139, 35, 139.001, 35.001],
      platforms: [],
      warnings: [],
    },
    nodes,
    edges,
  };
}

/**
 * street --stairs-- hall --escalator-- gate, plus street --elevator-- gate. Two routes, so the
 * profile decides which one is taken.
 */
export function twoRouteGraph(): StationGraph {
  return graph(
    [node('street', 'street'), node('hall', 'junction', -1), node('gate', 'gate', -1)],
    [
      edge('stairs', 'street', 'hall', 'stairs', { seconds: 5 }),
      edge('esc', 'hall', 'gate', 'escalator', { seconds: 5 }),
      edge('lift', 'street', 'gate', 'elevator', { seconds: 40 }),
    ],
  );
}
