import { AttributionControl, Map as MapLibre, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import type {
  ExpressionSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 does not find its worker on its own under a bundler; Vite builds it as its own entry.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useRef } from 'react';
import { blankStyle, gsiBasemapStyle } from './basemapStyle';
import type { FeatureCollection } from 'geojson';
import { mapFeatures, networkLines, networkPoints } from './geojson';
import { EMPTY_ROUTE, stepBounds } from './routeGeojson';
import type { StationGraph, StationMapData } from './types';

setWorkerUrl(workerUrl);

export type Basemap = 'gsi' | 'off';

interface Props {
  graph: StationGraph;
  mapData: StationMapData;
  /** Whole-floor number shown. */
  panel: number;
  basemap: Basemap;
  /** Accessible name of the map region (already translated). */
  label: string;
  /** MapLibre's built-in UI strings (control labels, canvas title) in the page language. */
  locale: Record<string, string>;
  /** The route to draw (`routeFeatures`), or null for none. */
  route?: FeatureCollection | null;
  /** Index of the step to emphasise, or null for the whole route alike. */
  selectedStep?: number | null;
}

const ROUTE_CASING = '#111827';
const ROUTE_LINE = '#fde047';
const ROUTE_SELECTED = '#f97316';

const GLYPHS = 'https://maps.gsi.go.jp/xyz/noto-jp/{fontstack}/{range}.pbf';
const FONT = ['NotoSansCJKjp-Regular'];

/** One line layer per mode: width and dash pattern differ as well as colour. */
const LINE_LAYERS = [
  {
    id: 'net-walk',
    modes: ['walk', 'ramp', 'moving_walkway', 'fare_gate'],
    color: '#4b5563',
    width: 2,
    dash: undefined,
  },
  { id: 'net-elevator', modes: ['elevator'], color: '#14803c', width: 5, dash: undefined },
  { id: 'net-escalator', modes: ['escalator'], color: '#c2570c', width: 3, dash: [0.5, 1.5] },
  { id: 'net-stairs', modes: ['stairs'], color: '#b91c1c', width: 3, dash: [3, 2] },
] as const;

const POINT_COLOURS: Record<string, string> = {
  entrance: '#1d4ed8',
  gate: '#7c3aed',
  platform: '#0f766e',
  elevator: '#14803c',
  street: '#6b7280',
};

/** match expression from POINT_COLOURS; typed by hand because the spread loses the tuple type */
function pointColourExpression(): ExpressionSpecification {
  const expr: unknown[] = [
    'match',
    ['get', 'kind'],
    ...Object.entries(POINT_COLOURS).flat(),
    '#6b7280',
  ];
  return expr as ExpressionSpecification;
}

function panelFilter(panel: number): ExpressionSpecification {
  return ['==', ['get', 'panel'], panel];
}

function applyPanel(map: MapLibreMap, panel: number): void {
  const onPanel = panelFilter(panel);
  map.setFilter('floor-fill', ['all', ['==', ['get', 'kind'], 'floor'], onPanel]);
  map.setFilter('space-fill', ['all', ['==', ['get', 'kind'], 'space'], onPanel]);
  map.setFilter('space-outline', ['all', ['==', ['get', 'kind'], 'space'], onPanel]);
  map.setFilter('facility-points', ['all', ['==', ['get', 'kind'], 'facility'], onPanel]);
  for (const l of LINE_LAYERS) {
    map.setFilter(l.id, ['all', ['in', ['get', 'mode'], ['literal', [...l.modes]]], onPanel]);
  }
  map.setFilter('net-points', ['all', onPanel, ['!=', ['get', 'kind'], 'street']]);
  if (map.getLayer('net-labels'))
    map.setFilter('net-labels', ['all', onPanel, ['==', ['get', 'kind'], 'entrance']]);
}

/** Route layers follow the floor; the selected step is drawn on top, thicker and orange. */
function applyRoute(map: MapLibreMap, panel: number, selected: number | null): void {
  if (!map.getLayer('route-line')) return;
  const onPanel = panelFilter(panel);
  const isLine: ExpressionSpecification = ['==', ['get', 'kind'], 'line'];
  const isStep: ExpressionSpecification = ['==', ['get', 'step'], selected ?? -1];
  map.setFilter('route-casing', ['all', isLine, onPanel]);
  map.setFilter('route-line', ['all', isLine, onPanel]);
  map.setFilter('route-selected-casing', ['all', isLine, onPanel, isStep]);
  map.setFilter('route-selected', ['all', isLine, onPanel, isStep]);
  map.setFilter('route-markers', ['all', ['!=', ['get', 'kind'], 'line'], onPanel]);
  map.setFilter('route-marker-selected', ['all', ['!=', ['get', 'kind'], 'line'], onPanel, isStep]);
  if (map.getLayer('route-numbers')) {
    map.setFilter('route-numbers', ['all', ['==', ['get', 'kind'], 'start'], onPanel]);
  }
}

function addRouteLayers(map: MapLibreMap, props: Props): void {
  map.addSource('route', { type: 'geojson', data: props.route ?? EMPTY_ROUTE });
  const width = (base: number): ExpressionSpecification => [
    'interpolate',
    ['linear'],
    ['zoom'],
    15,
    base * 0.7,
    20,
    base * 2,
  ];
  const layout = { 'line-cap': 'round', 'line-join': 'round' } as const;
  map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: 'route',
    layout,
    paint: { 'line-color': ROUTE_CASING, 'line-width': width(9) },
  });
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: 'route',
    layout,
    paint: { 'line-color': ROUTE_LINE, 'line-width': width(5) },
  });
  map.addLayer({
    id: 'route-selected-casing',
    type: 'line',
    source: 'route',
    layout,
    paint: { 'line-color': ROUTE_CASING, 'line-width': width(14) },
  });
  map.addLayer({
    id: 'route-selected',
    type: 'line',
    source: 'route',
    layout,
    paint: { 'line-color': ROUTE_SELECTED, 'line-width': width(9) },
  });
  map.addLayer({
    id: 'route-markers',
    type: 'circle',
    source: 'route',
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        15,
        ['case', ['==', ['get', 'kind'], 'start'], 5, 3.5],
        20,
        ['case', ['==', ['get', 'kind'], 'start'], 11, 7],
      ],
      'circle-color': ['case', ['==', ['get', 'kind'], 'start'], ROUTE_LINE, '#ffffff'],
      'circle-stroke-color': ROUTE_CASING,
      'circle-stroke-width': 2.5,
    },
  });
  map.addLayer({
    id: 'route-marker-selected',
    type: 'circle',
    source: 'route',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 9, 20, 16],
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-color': ROUTE_SELECTED,
      'circle-stroke-width': 4,
    },
  });
  if (props.basemap === 'gsi') {
    map.addLayer({
      id: 'route-numbers',
      type: 'symbol',
      source: 'route',
      layout: {
        'text-field': ['get', 'label'],
        'text-font': [...FONT],
        'text-size': ['interpolate', ['linear'], ['zoom'], 15, 9, 20, 14],
        'text-allow-overlap': true,
      },
      paint: { 'text-color': ROUTE_CASING },
    });
  }
  applyRoute(map, props.panel, props.selectedStep ?? null);
}

function addLayers(map: MapLibreMap, props: Props): void {
  map.addSource('mapdata', { type: 'geojson', data: mapFeatures(props.mapData) });
  map.addSource('network', { type: 'geojson', data: networkLines(props.graph) });
  map.addSource('points', { type: 'geojson', data: networkPoints(props.graph) });

  map.addLayer({
    id: 'floor-fill',
    type: 'fill',
    source: 'mapdata',
    paint: { 'fill-color': '#fbfbfa', 'fill-opacity': 0.9 },
  });
  map.addLayer({
    id: 'space-fill',
    type: 'fill',
    source: 'mapdata',
    paint: { 'fill-color': ['get', 'colour'], 'fill-opacity': 0.85 },
  });
  map.addLayer({
    id: 'space-outline',
    type: 'line',
    source: 'mapdata',
    paint: { 'line-color': '#9aa3a0', 'line-width': 0.6 },
  });
  for (const l of LINE_LAYERS) {
    map.addLayer({
      id: l.id,
      type: 'line',
      source: 'network',
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': l.color,
        'line-width': ['interpolate', ['linear'], ['zoom'], 15, l.width * 0.6, 20, l.width * 2],
        ...(l.dash ? { 'line-dasharray': [...l.dash] } : {}),
      },
    });
  }
  map.addLayer({
    id: 'facility-points',
    type: 'circle',
    source: 'mapdata',
    paint: { 'circle-radius': 2.5, 'circle-color': '#374151', 'circle-opacity': 0.7 },
  });
  map.addLayer({
    id: 'net-points',
    type: 'circle',
    source: 'points',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 3, 20, 8],
      'circle-color': pointColourExpression(),
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
    },
  });
  if (props.basemap === 'gsi') {
    map.addLayer({
      id: 'net-labels',
      type: 'symbol',
      source: 'points',
      layout: {
        'text-field': ['get', 'label'],
        'text-font': [...FONT],
        'text-size': 13,
        'text-offset': [0, 1.2],
        'text-allow-overlap': false,
      },
      paint: { 'text-color': '#1e3a8a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    });
  }
  applyPanel(map, props.panel);
  addRouteLayers(map, props);
}

function styleFor(basemap: Basemap): StyleSpecification {
  const style = basemap === 'gsi' ? gsiBasemapStyle() : blankStyle();
  return basemap === 'gsi' ? { ...style, glyphs: GLYPHS } : style;
}

export default function StationMap(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loaded = useRef(false);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  // Create the map once per station.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const [w, s, e, n] = props.graph.station.bbox;
    const map = new MapLibre({
      container: el,
      style: styleFor(props.basemap),
      bounds: [
        [w, s],
        [e, n],
      ],
      fitBoundsOptions: { padding: 40, animate: false },
      attributionControl: false,
      locale: props.locale,
      fadeDuration: reduced ? 0 : 300,
      keyboard: true,
      maxZoom: 21,
    });
    map.addControl(new AttributionControl({ compact: true }));
    map.addControl(new NavigationControl({ showCompass: false }));
    mapRef.current = map;
    loaded.current = false;
    map.on('load', () => {
      loaded.current = true;
      addLayers(map, latest.current);
    });
    return () => {
      map.remove();
      mapRef.current = null;
      loaded.current = false;
    };
    // The map is rebuilt only when the station, basemap or language changes; the floor is applied below.
  }, [props.graph, props.mapData, props.basemap, props.locale]);

  // Change floor without rebuilding the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded.current) return;
    applyPanel(map, props.panel);
    applyRoute(map, props.panel, props.selectedStep ?? null);
    // `selectedStep` has its own effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.panel]);

  // New route: swap the data without rebuilding the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded.current) return;
    void map.getSource<GeoJSONSource>('route')?.setData(props.route ?? EMPTY_ROUTE);
  }, [props.route]);

  // Select a step: emphasise it and bring it into view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded.current) return;
    const selected = props.selectedStep ?? null;
    applyRoute(map, props.panel, selected);
    if (selected === null || !props.route) return;
    const b = stepBounds(props.route, selected, props.panel);
    if (!b) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.fitBounds(
      [
        [b[0], b[1]],
        [b[2], b[3]],
      ],
      { padding: 90, maxZoom: 20, duration: reduced ? 0 : 400 },
    );
    // Runs when the selection changes; the floor and route are read as they are at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedStep]);

  return <div ref={container} className="station-map" role="region" aria-label={props.label} />;
}
