import { edge, graph, node } from '../routing/fixtures';
import type { StationGraph } from '../routing/types';
import type { StationIndex, StationMapData } from './types';

/** A two-floor station: ground entrance A1, a lift to B1, a gate and a platform area on B1. */
export function testGraph(): StationGraph {
  const g = graph(
    [
      { ...node('a1', 'entrance', 0), name: { ja: 'A1' } },
      { ...node('a2', 'entrance', 0), name: { ja: 'A10' } },
      { ...node('a0', 'entrance', 0) },
      node('lift-top', 'elevator', 0),
      node('lift-bot', 'elevator', -1),
      node('gate', 'gate', -1),
      { ...node('p1', 'platform', -1.5), platformId: 'P1' },
      { ...node('p2', 'platform', -1.5), platformId: 'P1' },
    ],
    [
      edge('e-walk', 'a1', 'lift-top', 'walk'),
      edge('e-lift', 'lift-top', 'lift-bot', 'elevator', { seconds: 40 }),
      edge('e-esc', 'lift-top', 'gate', 'escalator'),
      edge('e-st', 'gate', 'p1', 'stairs'),
      edge('e-gate', 'lift-bot', 'gate', 'fare_gate'),
    ],
  );
  return {
    ...g,
    station: {
      ...g.station,
      levels: [0, -1, -1.5],
      platforms: [{ id: 'P1', code: '3', nodeIds: ['p1', 'p2'] }],
      warnings: [],
    },
  };
}

export function testMap(): StationMapData {
  return {
    type: 'FeatureCollection',
    schemaVersion: 1,
    stationId: 'T',
    slug: 't',
    panels: [
      { panel: 0, hasMap: false, nameJa: null, levels: [0] },
      { panel: -1, hasMap: true, nameJa: '地下1階', levels: [-1] },
      { panel: -2, hasMap: true, nameJa: '地下2階', levels: [-1.5] },
    ],
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [139, 35] },
        properties: { kind: 'facility', ordinal: -1, category: 'F003' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [139, 35] },
        properties: { kind: 'facility', ordinal: -1, category: 'F012' },
      },
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [139, 35],
              [139, 35.1],
              [139.1, 35],
              [139, 35],
            ],
          ],
        },
        properties: { kind: 'space', ordinal: -1, category: 'B022' },
      },
    ],
  };
}

export function testIndex(): StationIndex {
  return {
    schemaVersion: 1,
    stations: [
      {
        id: 'T',
        slug: 't',
        name: { ja: 'テスト', en: 'Test' },
        tier: 2,
        bbox: [139, 35, 139.001, 35.001],
        file: 'T.json',
        nodes: 8,
        edges: 5,
        warnings: [],
      },
    ],
  };
}
