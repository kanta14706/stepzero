import type { GraphEdge, GraphNode, StationGraph } from '../routing/types';

export type { GraphEdge, GraphNode, StationGraph };

export interface StationIndexEntry {
  id: string;
  slug: string;
  name: Partial<Record<string, string>>;
  tier: 1 | 2;
  bbox: [number, number, number, number];
  file: string;
  nodes: number;
  edges: number;
  warnings: string[];
}

export interface StationIndex {
  schemaVersion: 1;
  stations: StationIndexEntry[];
}

export interface MapPanel {
  /** Whole-floor number the panel stands for (0 is the outdoor ground, negative is below). */
  panel: number;
  /** False when the source map has no polygons for this floor: only the network is drawn. */
  hasMap: boolean;
  nameJa: string | null;
  /** Graph levels shown on this panel (half floors sit on the floor below). */
  levels: number[];
}

export type MapFeatureKind = 'floor' | 'space' | 'facility';

export interface MapFeatureProperties {
  kind: MapFeatureKind;
  ordinal: number;
  category?: string;
  categoryJa?: string | null;
  nameJa?: string | null;
}

export interface MapFeature {
  type: 'Feature';
  geometry: { type: 'Polygon' | 'Point'; coordinates: unknown };
  properties: MapFeatureProperties;
}

export interface StationMapData {
  type: 'FeatureCollection';
  schemaVersion: 1;
  stationId: string;
  slug: string;
  panels: MapPanel[];
  features: MapFeature[];
}
