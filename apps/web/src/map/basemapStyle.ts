import type { StyleSpecification } from 'maplibre-gl';

/**
 * A compact basemap on the 国土地理院 vector tiles ("地理院地図Vector（仮称）", experimental_bvmap):
 * water, buildings, roads and railways only. GSI's own style has 774 layers and is 850 KB; this
 * one is small enough to ship with the app. Credit as the GSI terms require (shown in the map's
 * attribution control).
 */
export function gsiBasemapStyle(): StyleSpecification {
  const source = 'gsi';
  return {
    version: 8,
    sources: {
      [source]: {
        type: 'vector',
        tiles: ['https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/{z}/{x}/{y}.pbf'],
        minzoom: 4,
        maxzoom: 16,
        attribution:
          '<a href="https://maps.gsi.go.jp/vector/" target="_blank" rel="noopener">地理院地図Vector（仮称）</a>',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#f6f5f1' } },
      {
        id: 'water',
        type: 'fill',
        source,
        'source-layer': 'waterarea',
        paint: { 'fill-color': '#cfe0ee' },
      },
      {
        id: 'buildings',
        type: 'fill',
        source,
        'source-layer': 'building',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#e4e1da', 'fill-outline-color': '#cfcbc2' },
      },
      {
        id: 'roads-casing',
        type: 'line',
        source,
        'source-layer': 'road',
        paint: {
          'line-color': '#d4d0c6',
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 7, 19, 16],
        },
      },
      {
        id: 'roads',
        type: 'line',
        source,
        'source-layer': 'road',
        paint: {
          'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 16, 5, 19, 14],
        },
      },
      {
        id: 'railways',
        type: 'line',
        source,
        'source-layer': 'railway',
        paint: {
          'line-color': '#8a8f98',
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 18, 3],
          'line-dasharray': [4, 2],
        },
      },
    ],
  };
}

/** No basemap, for tests and for the "?basemap=off" switch. */
export function blankStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#f6f5f1' } }],
  };
}
