import { useEffect, useId, useMemo, useState } from 'react';
import type { PlannedRoute } from '../../map/routeGeojson';
import { fmt, useI18n } from '../../i18n';
import type { Dictionary } from '../../i18n/ja';
import { indexGraph } from '../../routing/astar';
import type { WorkerLike } from '../../routing/client';
import { PROFILES } from '../../routing/profiles';
import { routeToSteps } from '../../routing/steps';
import type { GraphNode, Platform, ProfileId, StationGraph } from '../../routing/types';
import { describeFailure, describeStep, nameIn, roundMetres } from './describe';
import { useStationRoute } from './useStationRoute';

type Direction = 'in' | 'out';

const PROFILE_ORDER = Object.keys(PROFILES) as ProfileId[];
const SIDES = [
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
] as const;

/** Which side of the station an entrance is on, from the middle of the station's bounding box. */
function sideOf(node: GraphNode, bbox: StationGraph['station']['bbox']): (typeof SIDES)[number] {
  const lat0 = (bbox[1] + bbox[3]) / 2;
  const dx = (node.lon - (bbox[0] + bbox[2]) / 2) * Math.cos((lat0 * Math.PI) / 180);
  const dy = node.lat - lat0;
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI; // clockwise from north
  return SIDES[Math.round((((deg % 360) + 360) % 360) / 45) % 8] as (typeof SIDES)[number];
}

interface EntranceOption {
  id: string;
  label: string;
}

/** Entrances by label. Repeated or missing labels get the side of the station, so they can be told apart. */
function entranceOptions(graph: StationGraph, t: Dictionary): EntranceOption[] {
  const entrances = graph.nodes.filter((n) => n.kind === 'entrance');
  const labelOf = (n: GraphNode): string | null => n.name?.['ja'] ?? null;
  const counts = new Map<string | null, number>();
  for (const n of entrances) counts.set(labelOf(n), (counts.get(labelOf(n)) ?? 0) + 1);
  return entrances
    .map((n) => {
      const label = labelOf(n);
      const ambiguous = label === null || (counts.get(label) ?? 0) > 1;
      const shown = label ?? t.unnamed;
      return {
        id: n.id,
        sortKey: label,
        label: ambiguous
          ? fmt(t.routeEntranceOptionSide, {
              label: shown,
              side: t.sides[sideOf(n, graph.station.bbox)],
            })
          : fmt(t.routeEntranceOption, { label: shown }),
      };
    })
    .sort((a, b) => {
      if (a.sortKey === null || b.sortKey === null) {
        return a.sortKey === b.sortKey ? 0 : a.sortKey === null ? 1 : -1; // unlabelled last
      }
      return (
        a.sortKey.localeCompare(b.sortKey, 'ja', { numeric: true }) ||
        a.label.localeCompare(b.label, 'ja')
      );
    });
}

interface Props {
  graph: StationGraph;
  /** Test hook: a fake router worker. */
  createWorker?: () => WorkerLike;
  /** Called with the route and its steps whenever they change (null when there is no route). */
  onRouteChange?: (route: PlannedRoute | null) => void;
  /** The step the map is showing, and the way to change it. Without them the buttons are hidden. */
  selectedStep?: number | null;
  onSelectStep?: (step: number | null) => void;
  /** Moves the focus past the step list, to the floor switcher. Shows a skip button when given. */
  onSkipToMap?: () => void;
}

/** Pick direction, entrance, platform and profile; shows the steps or why there is no route. */
export function RoutePlanner({
  graph,
  createWorker,
  onRouteChange,
  selectedStep = null,
  onSelectStep,
  onSkipToMap,
}: Props) {
  const { t, lang } = useI18n();
  const uid = useId();
  const [direction, setDirection] = useState<Direction>('in');
  const [entrance, setEntrance] = useState(''); // '' = any
  const [platform, setPlatform] = useState(graph.station.platforms[0]?.id ?? '');
  const [profile, setProfile] = useState<ProfileId>('wheelchair');

  const index = useMemo(() => indexGraph(graph), [graph]);
  const entrances = useMemo(() => entranceOptions(graph, t), [graph, t]);

  const query = useMemo(() => {
    const platformNodes = graph.station.platforms.find((p) => p.id === platform)?.nodeIds ?? [];
    // "Any" also starts from street nodes: at 新宿 the only step-free way in is an unnamed one.
    const entranceNodes = entrance
      ? [entrance]
      : graph.nodes.filter((n) => n.kind === 'entrance' || n.kind === 'street').map((n) => n.id);
    const [from, to] =
      direction === 'in' ? [entranceNodes, platformNodes] : [platformNodes, entranceNodes];
    return { from, to, profile };
  }, [graph, direction, entrance, platform, profile]);

  const state = useStationRoute(graph, query, createWorker);

  const steps = useMemo(
    () => (state.status === 'ready' && state.result.ok ? routeToSteps(index, state.result) : []),
    [index, state],
  );

  const planned = useMemo<PlannedRoute | null>(
    () =>
      state.status === 'ready' && state.result.ok
        ? { nodes: state.result.nodes, legs: state.result.legs, steps }
        : null,
    [state, steps],
  );
  useEffect(() => {
    onRouteChange?.(planned);
  }, [planned, onRouteChange]);

  const platformLabel = (p: Platform) => {
    const name = p.code ? fmt(t.steps.platform, { code: p.code }) : p.id;
    if (p.travel?.terminating === 'all') return fmt(t.routePlatformTerminating, { platform: name });
    if (p.travel?.nextStop) {
      return fmt(t.routePlatformToward, { platform: name, next: nameIn(p.travel.nextStop, lang) });
    }
    return name;
  };

  return (
    <section aria-labelledby={`${uid}-title`} className="planner">
      <h3 id={`${uid}-title`}>{t.routeTitle}</h3>
      <p>{t.routeIntro}</p>

      <fieldset className="choices">
        <legend>{t.routeDirection}</legend>
        {(['in', 'out'] as const).map((d) => (
          <label key={d} className="choice">
            <input
              type="radio"
              name={`${uid}-direction`}
              checked={direction === d}
              onChange={() => {
                setDirection(d);
              }}
            />
            <span>{d === 'in' ? t.routeDirectionIn : t.routeDirectionOut}</span>
          </label>
        ))}
      </fieldset>

      <div className="field">
        <label htmlFor={`${uid}-entrance`}>{t.routeEntrance}</label>
        <select
          id={`${uid}-entrance`}
          value={entrance}
          onChange={(e) => {
            setEntrance(e.target.value);
          }}
        >
          <option value="">{t.routeEntranceAny}</option>
          {entrances.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor={`${uid}-platform`}>{t.routePlatform}</label>
        <select
          id={`${uid}-platform`}
          value={platform}
          onChange={(e) => {
            setPlatform(e.target.value);
          }}
        >
          {graph.station.platforms.map((p) => (
            <option key={p.id} value={p.id}>
              {platformLabel(p)}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="choices" aria-describedby={`${uid}-hint`}>
        <legend>{t.routeProfile}</legend>
        {PROFILE_ORDER.map((p) => (
          <label key={p} className="choice">
            <input
              type="radio"
              name={`${uid}-profile`}
              checked={profile === p}
              onChange={() => {
                setProfile(p);
              }}
            />
            <span>{t.profiles[p]}</span>
          </label>
        ))}
        <p id={`${uid}-hint`} className="hint">
          {t.profileHints[profile]}
        </p>
      </fieldset>

      <p role="status" aria-live="polite" className="floor-status">
        {state.status === 'ready' &&
          (state.result.ok ? fmt(t.routeAnnounce, { n: steps.length }) : t.routeAnnounceNone)}
      </p>

      {state.status === 'error' && <p role="alert">{t.loadError}</p>}

      {state.status === 'ready' && state.result.ok && (
        <>
          <h4>{t.routeStepsTitle}</h4>
          <p>
            {fmt(t.routeSummary, {
              m: roundMetres(state.result.summary.lengthM),
              rides: state.result.summary.elevators,
            })}
          </p>
          {onSkipToMap && (
            <button type="button" className="step-button skip-steps" onClick={onSkipToMap}>
              {t.routeSkipToMap}
            </button>
          )}
          <ol className="steps">
            {steps.map((step, i) => {
              const { text, notes } = describeStep(step, t, profile, lang);
              return (
                <li key={i} data-kind={step.kind} data-step={i} data-selected={selectedStep === i}>
                  <span>{text}</span>
                  {notes.map((n) => (
                    <span key={n} className="step-note">
                      {n}
                    </span>
                  ))}
                  {onSelectStep && (
                    <div className="step-actions">
                      <button
                        type="button"
                        className="step-button"
                        aria-pressed={selectedStep === i}
                        aria-label={fmt(t.routeShowOnMapStep, { n: i + 1 })}
                        onClick={() => {
                          onSelectStep(selectedStep === i ? null : i);
                        }}
                      >
                        {t.routeShowOnMap}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {state.result.summary.elevators > 0 && <p className="hint">{t.routeElevatorNote}</p>}
        </>
      )}

      {state.status === 'ready' && !state.result.ok && (
        <NoRoute failure={state.result.failure} alternatives={state.result.alternatives} />
      )}
    </section>
  );
}

function NoRoute({
  failure,
  alternatives,
}: {
  failure: Parameters<typeof describeFailure>[0];
  alternatives: Parameters<typeof describeFailure>[1];
}) {
  const { t } = useI18n();
  const f = describeFailure(failure, alternatives, t);
  return (
    <div role="alert" className="notice-inline no-route">
      <h4>{f.title}</h4>
      <p>{f.reason}</p>
      {f.notes.map((n) => (
        <p key={n}>{n}</p>
      ))}
      <h5>{t.noRoute.alternativesTitle}</h5>
      <ul>
        {f.alternatives.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </div>
  );
}
