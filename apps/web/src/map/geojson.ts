import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { panelOf } from './floors';
import type { StationGraph, StationMapData } from './types';

/** Space categories drawn in their own colour (GSI indoor spec). */
export const SPACE_COLOURS: Record<string, string> = {
  B022: '#2e9e5b', // elevator
  B021: '#d9534f', // stairs
  B023: '#e8892b', // escalator
  B025: '#4a7fbf', // slope
  B029: '#eef1f0', // walkway / concourse
  B028: '#dfe6f2', // platform
};
export const DEFAULT_SPACE_COLOUR = '#d8dcdb';

/** Polygons and facility points with a `panel` property (the whole floor they are shown on). */
export function mapFeatures(map: StationMapData): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: map.features.map((f) => ({
      type: 'Feature',
      geometry: f.geometry as Geometry,
      properties: {
        ...f.properties,
        panel: f.properties.ordinal,
        colour: SPACE_COLOURS[f.properties.category ?? ''] ?? DEFAULT_SPACE_COLOUR,
      },
    })),
  };
}

/**
 * Walking paths as lines. An edge is drawn on a floor only when both ends are on that floor;
 * edges between floors (lifts, flights) show up through their end nodes instead.
 */
export function networkLines(graph: StationGraph): FeatureCollection {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const features: Feature[] = [];
  for (const e of graph.edges) {
    const a = nodes.get(e.from);
    const b = nodes.get(e.to);
    if (!a || !b || panelOf(a.level) !== panelOf(b.level)) continue;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [a.lon, a.lat],
          [b.lon, b.lat],
        ],
      },
      properties: { id: e.id, mode: e.mode, panel: panelOf(a.level) },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** Points of interest on the network: entrances, gates, platform areas, lifts. */
export function networkPoints(graph: StationGraph): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: graph.nodes
      .filter((n) => n.kind !== 'junction')
      .map((n) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [n.lon, n.lat] },
        properties: {
          id: n.id,
          kind: n.kind,
          panel: panelOf(n.level),
          label: n.kind === 'entrance' ? (n.name?.['ja'] ?? '') : '',
        },
      })),
  };
}
