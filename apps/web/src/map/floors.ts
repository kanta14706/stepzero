import { fmt } from '../i18n';
import type { Dictionary } from '../i18n/ja';
import type { GraphEdge, GraphNode, StationGraph, StationMapData } from './types';

/** Switcher label for a whole-floor number: ground, "B2" or "3". Text comes from the dictionary. */
export function floorLabel(panel: number, t: Dictionary): string {
  if (panel === 0) return t.floorGround;
  return panel < 0 ? fmt(t.floorBelow, { n: -panel }) : fmt(t.floorAbove, { n: panel });
}

/** The whole floor a graph level is shown on: half floors sit on the floor below. */
export const panelOf = (level: number): number => Math.floor(level);

/** Elements on one floor, from the graph (the routing source of truth) and the station map. */
export interface FloorSummary {
  /** Entrance labels such as "A1"; `null` entries are entrances without a label. */
  entrances: (string | null)[];
  gates: number;
  /** Platform ids with the number of boarding areas on this floor. */
  platforms: { id: string; code: string | null; areas: number }[];
  elevators: number;
  escalators: number;
  stairs: number;
  ramps: number;
  /** `null` when the floor has no station-map polygons, so the count is unknown. */
  toilets: number | null;
}

const TOILET_FACILITIES = new Set(['F001', 'F002', 'F003', 'F004']);

export function summariseFloor(
  graph: StationGraph,
  map: StationMapData,
  panel: number,
): FloorSummary {
  const nodeById = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));
  const onPanel = (n: GraphNode | undefined): boolean =>
    n !== undefined && panelOf(n.level) === panel;

  const here = graph.nodes.filter((n) => panelOf(n.level) === panel);
  const platformAreas = new Map<string, number>();
  for (const n of here) {
    if (n.kind === 'platform' && n.platformId) {
      platformAreas.set(n.platformId, (platformAreas.get(n.platformId) ?? 0) + 1);
    }
  }
  const platformCode = new Map(graph.station.platforms.map((p) => [p.id, p.code ?? null]));

  // An edge belongs to the floor of its start node (cab hops and flights count once).
  const edgesHere: GraphEdge[] = graph.edges.filter((e) => onPanel(nodeById.get(e.from)));
  const count = (mode: GraphEdge['mode']) => edgesHere.filter((e) => e.mode === mode).length;

  const panelInfo = map.panels.find((p) => p.panel === panel);
  const toilets = panelInfo?.hasMap
    ? map.features.filter(
        (f) =>
          f.properties.kind === 'facility' &&
          f.properties.ordinal === panel &&
          f.properties.category !== undefined &&
          TOILET_FACILITIES.has(f.properties.category),
      ).length
    : null;

  return {
    entrances: here
      .filter((n) => n.kind === 'entrance')
      .map((n) => n.name?.['ja'] ?? null)
      .sort((a, b) => {
        if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1; // unlabelled last
        return a.localeCompare(b, 'ja', { numeric: true });
      }),
    gates: here.filter((n) => n.kind === 'gate').length,
    platforms: [...platformAreas].map(([id, areas]) => ({
      id,
      code: platformCode.get(id) ?? null,
      areas,
    })),
    elevators: count('elevator'),
    escalators: count('escalator'),
    stairs: count('stairs'),
    ramps: count('ramp'),
    toilets,
  };
}
