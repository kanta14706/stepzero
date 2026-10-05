import type { Feature, FeatureCollection, Position } from 'geojson';
import type { Step } from '../routing/steps';
import { panelOf } from '../routing/steps';
import type { NodeId, RouteLeg, StationGraph } from '../routing/types';

/** A found route with its steps: what the map needs to draw it. */
export interface PlannedRoute {
  nodes: NodeId[];
  legs: RouteLeg[];
  steps: Step[];
}

export const EMPTY_ROUTE: FeatureCollection = { type: 'FeatureCollection', features: [] };

const VERTICAL: ReadonlySet<Step['kind']> = new Set(['elevator', 'stairs', 'escalator']);

/**
 * The route as GeoJSON. Each leg is a line when both its ends are on the same whole floor (as
 * for the network layer); legs between floors have no line, so each step gets a numbered marker
 * where it starts, and a hollow one where a lift or flight ends on another floor. Every feature
 * carries `step` (its index in the step list, so the map and the list agree) and `panel`.
 */
export function routeFeatures(graph: StationGraph, route: PlannedRoute): FeatureCollection {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const at = (id: NodeId | undefined) => (id === undefined ? undefined : nodes.get(id));
  const features: Feature[] = [];

  route.legs.forEach((_, i) => {
    const a = at(route.nodes[i]);
    const b = at(route.nodes[i + 1]);
    if (!a || !b || panelOf(a.level) !== panelOf(b.level)) return;
    const step = route.steps.findIndex((s) => i >= s.legStart && i < s.legEnd);
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [a.lon, a.lat],
          [b.lon, b.lat],
        ],
      },
      properties: { kind: 'line', step, panel: panelOf(a.level) },
    });
  });

  route.steps.forEach((s, i) => {
    const start = at(route.nodes[s.legStart]);
    if (start) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [start.lon, start.lat] },
        properties: { kind: 'start', step: i, panel: panelOf(start.level), label: String(i + 1) },
      });
    }
    const end = at(route.nodes[s.legEnd]);
    if (end && VERTICAL.has(s.kind) && panelOf(end.level) !== s.panel) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [end.lon, end.lat] },
        properties: { kind: 'end', step: i, panel: panelOf(end.level), label: '' },
      });
    }
  });

  return { type: 'FeatureCollection', features };
}

/** [west, south, east, north] of a step's features on one floor, or null when there are none. */
export function stepBounds(
  routeData: FeatureCollection,
  step: number,
  panel: number,
): [number, number, number, number] | null {
  const points: Position[] = [];
  for (const f of routeData.features) {
    if (f.properties?.['step'] !== step || f.properties['panel'] !== panel) continue;
    if (f.geometry.type === 'LineString') points.push(...f.geometry.coordinates);
    else if (f.geometry.type === 'Point') points.push(f.geometry.coordinates);
  }
  if (points.length === 0) return null;
  const lons = points.map((p) => p[0] as number);
  const lats = points.map((p) => p[1] as number);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}
