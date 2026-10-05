import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { RoutePlanner } from '../features/station-view/RoutePlanner';
import { fmt, useI18n } from '../i18n';
import { FloorSummaryList } from './FloorSummaryList';
import { FloorSwitcher } from './FloorSwitcher';
import { MapLegend } from './MapLegend';
import { routeFeatures } from './routeGeojson';
import type { PlannedRoute } from './routeGeojson';
import { loadStationGraph, loadStationMap } from './data';
import { floorLabel, summariseFloor } from './floors';
import { stationName } from './StationList';
import type { Basemap } from './StationMap';
import type { StationGraph, StationMapData } from './types';

// MapLibre is large; load it only when a station page is opened (first-load budget).
const StationMap = lazy(() => import('./StationMap'));

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; graph: StationGraph; map: StationMapData };

/** `?basemap=off` draws only the station data (used by the tests, and handy offline). */
function basemapFromUrl(): Basemap {
  return new URLSearchParams(window.location.search).get('basemap') === 'off' ? 'off' : 'gsi';
}

export function StationPage({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [panel, setPanel] = useState<number | null>(null);
  const [route, setRoute] = useState<PlannedRoute | null>(null);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadStationGraph(id), loadStationMap(id)]).then(
      ([graph, map]) => {
        if (cancelled) return;
        setState({ status: 'ready', graph, map });
        // Start on the highest floor that has a station map (usually B1).
        setPanel(map.panels.find((p) => p.hasMap)?.panel ?? map.panels[0]?.panel ?? 0);
      },
      () => {
        if (!cancelled) setState({ status: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  const ready = state.status === 'ready' ? state : null;

  const hasPanel = useCallback(
    (p: number) => ready?.map.panels.some((x) => x.panel === p) ?? false,
    [ready],
  );
  // A new route starts with nothing selected and the map on the floor where it begins.
  const onRouteChange = useCallback(
    (next: PlannedRoute | null) => {
      setRoute(next);
      setSelectedStep(null);
      const first = next?.steps[0]?.panel;
      if (first !== undefined && hasPanel(first)) setPanel(first);
    },
    [hasPanel],
  );
  // Selecting a step shows the floor it starts on.
  const onSelectStep = useCallback(
    (step: number | null) => {
      setSelectedStep(step);
      const target = step === null ? undefined : route?.steps[step]?.panel;
      if (target !== undefined && hasPanel(target)) setPanel(target);
    },
    [route, hasPanel],
  );
  const routeData = useMemo(
    () => (ready && route ? routeFeatures(ready.graph, route) : null),
    [ready, route],
  );
  const current =
    ready && panel !== null ? ready.map.panels.find((p) => p.panel === panel) : undefined;
  const summary = useMemo(
    () => (ready && panel !== null ? summariseFloor(ready.graph, ready.map, panel) : null),
    [ready, panel],
  );

  return (
    <>
      <p>
        <a href="#/">{t.backToStations}</a>
      </p>
      {state.status === 'loading' && <p role="status">{t.loading}</p>}
      {state.status === 'error' && <p role="alert">{t.loadError}</p>}
      {ready && panel !== null && summary && (
        <>
          <h2>{`${stationName(ready.graph.station, lang)} · ${t.stationMapTitle}`}</h2>
          <p>
            {t.tierLine}: {t.tier2Name}
          </p>
          <StationWarnings graph={ready.graph} />
          <RoutePlanner
            graph={ready.graph}
            onRouteChange={onRouteChange}
            selectedStep={selectedStep}
            onSelectStep={onSelectStep}
          />
          <FloorSwitcher panels={ready.map.panels} value={panel} onChange={setPanel} />
          <p role="status" aria-live="polite" className="floor-status">
            {fmt(t.floorAnnouncement, { floor: floorLabel(panel, t) })}
          </p>
          {current && !current.hasMap && <p className="notice-inline">{t.noMapForFloor}</p>}
          <Suspense fallback={<p role="status">{t.loading}</p>}>
            <StationMap
              graph={ready.graph}
              mapData={ready.map}
              panel={panel}
              basemap={basemapFromUrl()}
              label={`${fmt(t.mapAriaLabel, { floor: floorLabel(panel, t) })}${routeData ? ` ${t.mapRouteNote}` : ''}`}
              route={routeData}
              selectedStep={selectedStep}
            />
          </Suspense>
          <MapLegend showRoute={routeData !== null} />
          <FloorSummaryList summary={summary} />
        </>
      )}
    </>
  );
}

function StationWarnings({ graph }: { graph: StationGraph }) {
  const { t } = useI18n();
  const codes = new Set(graph.station.warnings.map((w) => w.code));
  return (
    <>
      {codes.has('unverified_on_site') && <p className="notice-inline">{t.warningUnverified}</p>}
      {codes.has('no_step_free_route_optimistic') && (
        <p className="notice-inline">{t.warningStepFree}</p>
      )}
    </>
  );
}
