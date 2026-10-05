import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { fmt, useI18n } from '../../i18n';
import { PROFILES } from '../../routing/profiles';
import type { ProfileId } from '../../routing/types';
import { ReportFeedback, useReporter } from '../report/ReportControls';
import { describeFailure } from '../station-view/describe';
import { JourneyTimeline, journeySummary, stationName } from './JourneyTimeline';
import { PlacePicker } from './PlacePicker';
import { loadStations } from './stations';
import type { Journey, JourneyRequest, Place, Rejection, Station } from './types';
import { decodePlace, journeyHref, parseJourneyParams, tokyoIso, tokyoNowLocal } from './url';
import { journeyKey, useJourneyPlan } from './useJourneyPlan';
import type { JourneyPlanOptions, JourneyPlanState } from './useJourneyPlan';

const PROFILE_ORDER = Object.keys(PROFILES) as ProfileId[];
const NO_STATIONS: Station[] = [];

interface Props {
  /** The query string of `#/journey?...`; '' on the home page. */
  params: string;
  /** Test hooks. */
  options?: JourneyPlanOptions;
  searchFetch?: typeof fetch;
  navigate?: (href: string) => void;
}

const sameEnd = (a: Place, b: Place): boolean =>
  a.kind === 'station' && b.kind === 'station'
    ? a.station.id === b.station.id
    : a.kind === 'point' && b.kind === 'point' && a.lat === b.lat && a.lon === b.lon;

/**
 * The journey planner: two places, a profile and a time, then the step-free journeys. The plan
 * itself lives in the URL, so the form can be filled again after a reload or from a shared link.
 */
export function JourneyPlanner({ params, options, searchFetch, navigate }: Props) {
  const { t } = useI18n();
  const j = t.journey;
  const uid = useId();
  const [stations, setStations] = useState<Station[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadStations().then(
      (list) => {
        if (!cancelled) setStations(list.stations);
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const parsed = useMemo(() => parseJourneyParams(params), [params]);

  // The form, filled from the URL once the station list is there.
  const [form, setForm] = useState<{
    params: string | null;
    from: Place | null;
    to: Place | null;
    profile: ProfileId;
    when: 'now' | 'at';
    at: string;
  }>({
    params: null,
    from: null,
    to: null,
    profile: parsed.profile,
    when: 'now',
    at: tokyoNowLocal(),
  });
  if (stations && form.params !== params) {
    setForm({
      params,
      from: decodePlace(parsed.from, stations) ?? (params ? null : form.from),
      to: decodePlace(parsed.to, stations) ?? (params ? null : form.to),
      profile: parsed.profile,
      when: parsed.at ? 'at' : 'now',
      at: parsed.at ?? form.at,
    });
  }
  const [problem, setProblem] = useState<'missing' | 'same' | null>(null);

  // "Now" is fixed when a search is made, so re-renders do not re-plan.
  const [search, setSearch] = useState<{ params: string; now: string; nonce: number }>({
    params,
    now: new Date().toISOString(),
    nonce: 0,
  });
  if (search.params !== params)
    setSearch({ params, now: new Date().toISOString(), nonce: search.nonce });

  const request = useMemo<JourneyRequest | null>(() => {
    if (!stations) return null;
    const from = decodePlace(parsed.from, stations);
    const to = decodePlace(parsed.to, stations);
    if (!from || !to || sameEnd(from, to)) return null;
    return {
      from,
      to,
      profile: parsed.profile,
      time: parsed.at ? tokyoIso(parsed.at) : search.now,
    };
    // search.nonce: searching again for the same URL plans again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stations, parsed, search.now, search.nonce]);

  const { state, outages } = useJourneyPlan(request, stations ?? [], options);
  const reporter = useReporter(outages.report);

  const submit = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.from || !form.to) {
      setProblem('missing');
      return;
    }
    if (sameEnd(form.from, form.to)) {
      setProblem('same');
      return;
    }
    setProblem(null);
    const href = journeyHref(form.from, form.to, form.profile, form.when === 'at' ? form.at : null);
    if (window.location.hash === href) {
      setSearch({ params, now: new Date().toISOString(), nonce: search.nonce + 1 });
    } else if (navigate) navigate(href);
    else window.location.hash = href;
  };

  return (
    <section aria-labelledby={`${uid}-title`} className="journey">
      <h2 id={`${uid}-title`}>{j.title}</h2>
      <p>{j.intro}</p>
      {loadFailed && <p role="alert">{t.loadError}</p>}
      {/* Shown at once (no layout shift); station matches appear when the list has loaded. */}
      <form onSubmit={submit} noValidate>
        <PlacePicker
          field={j.from}
          value={form.from}
          onChange={(from) => {
            setForm({ ...form, from });
          }}
          stations={stations ?? NO_STATIONS}
          {...(searchFetch && { searchFetch })}
        />
        <PlacePicker
          field={j.to}
          value={form.to}
          onChange={(to) => {
            setForm({ ...form, to });
          }}
          stations={stations ?? NO_STATIONS}
          {...(searchFetch && { searchFetch })}
        />
        {form.from && form.to && (
          <button
            type="button"
            className="step-button"
            onClick={() => {
              setForm({ ...form, from: form.to, to: form.from });
            }}
          >
            {j.swap}
          </button>
        )}

        <fieldset className="choices" aria-describedby={`${uid}-hint`}>
          <legend>{t.routeProfile}</legend>
          {PROFILE_ORDER.map((p) => (
            <label key={p} className="choice">
              <input
                type="radio"
                name={`${uid}-profile`}
                checked={form.profile === p}
                onChange={() => {
                  setForm({ ...form, profile: p });
                }}
              />
              <span>{t.profiles[p]}</span>
            </label>
          ))}
          <p id={`${uid}-hint`} className="hint">
            {t.profileHints[form.profile]}
          </p>
        </fieldset>

        <fieldset className="choices">
          <legend>{j.when}</legend>
          {(['now', 'at'] as const).map((w) => (
            <label key={w} className="choice">
              <input
                type="radio"
                name={`${uid}-when`}
                checked={form.when === w}
                onChange={() => {
                  setForm({ ...form, when: w });
                }}
              />
              <span>{w === 'now' ? j.now : j.at}</span>
            </label>
          ))}
          {form.when === 'at' && (
            <div className="field">
              <label htmlFor={`${uid}-at`}>{j.atLabel}</label>
              <input
                id={`${uid}-at`}
                type="datetime-local"
                value={form.at}
                onChange={(e) => {
                  if (e.target.value) setForm({ ...form, at: e.target.value });
                }}
              />
            </div>
          )}
        </fieldset>

        {problem && (
          <p role="alert" className="notice-inline">
            {problem === 'missing' ? j.missingEnds : j.sameEnds}
          </p>
        )}
        <button type="submit" className="primary-button">
          {j.submit}
        </button>
      </form>

      {request && stations && (
        <>
          <ReportFeedback feedback={reporter.feedback} busy={reporter.busy} />
          <JourneyResults
            key={`${params}#${search.nonce}`}
            state={state}
            stations={stations}
            profile={request.profile}
            outagesStatus={outages.status}
            outagesLoaded={outages.loaded}
            onReport={outages.status !== 'unavailable' ? reporter.send : undefined}
            reportBusy={reporter.busy}
          />
        </>
      )}
    </section>
  );
}

function JourneyResults({
  state,
  stations,
  profile,
  outagesStatus,
  outagesLoaded,
  onReport,
  reportBusy,
}: {
  state: JourneyPlanState;
  stations: Station[];
  profile: ProfileId;
  outagesStatus: ReturnType<typeof useJourneyPlan>['outages']['status'];
  outagesLoaded: boolean;
  onReport: Parameters<typeof JourneyTimeline>[0]['onReport'];
  reportBusy: boolean;
}) {
  const { t, lang } = useI18n();
  const j = t.journey;
  const uid = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const journeys = state.status === 'ready' ? state.planned.journeys : [];
  const keys = journeys.map(journeyKey);
  const index = Math.max(0, selected === null ? 0 : keys.indexOf(selected));
  const shown: Journey | undefined = journeys[index];
  const shownKey = shown ? journeyKey(shown) : null;

  // Re-routed: the reports changed what is blocked, after they had loaded, and the journey on
  // screen changed with them (React's "adjust state during render" pattern, as in RoutePlanner).
  const blockedKey = state.status === 'ready' ? state.blockedKey : null;
  const [seen, setSeen] = useState<{
    blockedKey: string | null;
    shownKey: string | null;
    loaded: boolean;
    rerouted: boolean;
  }>({
    blockedKey,
    shownKey,
    loaded: false,
    rerouted: false,
  });
  if (state.status === 'ready' && (seen.blockedKey !== blockedKey || seen.shownKey !== shownKey)) {
    const changed =
      seen.loaded &&
      seen.blockedKey !== null &&
      seen.blockedKey !== blockedKey &&
      seen.shownKey !== shownKey;
    setSeen({ blockedKey, shownKey, loaded: outagesLoaded, rerouted: seen.rerouted || changed });
  } else if (state.status === 'ready' && !seen.loaded && outagesLoaded) {
    setSeen({ ...seen, loaded: true });
  }

  // When results first arrive, move to them (the form above can be long).
  const ready = state.status === 'ready';
  useEffect(() => {
    if (ready) headingRef.current?.focus();
  }, [ready]);

  const announce =
    state.status === 'loading'
      ? j.planning
      : state.status === 'ready'
        ? journeys.length > 0
          ? `${seen.rerouted ? `${j.rerouted} ` : ''}${fmt(j.resultsAnnounce, { n: journeys.length })}`
          : j.noJourney
        : '';

  return (
    <section aria-labelledby={`${uid}-title`} className="journey-results">
      <p role="status" aria-live="polite" className="floor-status">
        {announce}
      </p>
      {state.status === 'error' && (
        <p role="alert" className="notice-inline">
          {j.errors[state.code]}
        </p>
      )}
      {state.status === 'ready' && (
        <>
          <h3 id={`${uid}-title`} ref={headingRef} tabIndex={-1}>
            {j.resultsTitle}
          </h3>
          {outagesStatus !== 'unavailable' && (
            <p className="hint outage-status" data-status={outagesStatus}>
              {t.outageStatus[outagesStatus]}
            </p>
          )}
          {seen.rerouted && journeys.length > 0 && (
            <p className="notice-inline rerouted">{j.rerouted}</p>
          )}
          {journeys.length === 0 ? (
            <NoJourney rejections={state.planned.rejections} stations={stations} />
          ) : (
            <>
              <ol className="journey-options">
                {journeys.map((jr, i) => {
                  const s = journeySummary(jr, t, lang);
                  return (
                    <li key={keys[i]}>
                      <button
                        type="button"
                        className="step-button journey-option"
                        aria-pressed={i === index}
                        onClick={() => {
                          setSelected(keys[i] ?? null);
                        }}
                      >
                        <span className="option-name">{fmt(j.option, { n: i + 1 })}</span>
                        <span>{s.times}</span>
                        <span>{s.facts}</span>
                        {jr.unverifiedStations.length > 0 && <span>{j.optionUnverified}</span>}
                      </button>
                    </li>
                  );
                })}
              </ol>
              {shown && (
                <section aria-labelledby={`${uid}-timeline`} className="journey-timeline">
                  <h3 id={`${uid}-timeline`}>{fmt(j.timelineTitle, { n: index + 1 })}</h3>
                  <JourneyTimeline
                    journey={shown}
                    stations={stations}
                    profile={profile}
                    onReport={onReport}
                    reportBusy={reportBusy}
                  />
                </section>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

/** Why no journey works: one entry per station and reason, with what to try instead. */
function NoJourney({ rejections, stations }: { rejections: Rejection[]; stations: Station[] }) {
  const { t, lang } = useI18n();
  const j = t.journey;
  const byId = useMemo(() => new Map(stations.map((s) => [s.id, s])), [stations]);
  const unique = new Map<string, Rejection>();
  for (const r of rejections) unique.set(`${r.stationId}|${r.role}|${r.failure.reason}`, r);
  return (
    <div role="alert" className="notice-inline no-route">
      <h4>{j.noJourney}</h4>
      {[...unique.values()].map((r) => {
        const f = describeFailure(r.failure, r.alternatives, t);
        return (
          <div key={`${r.stationId}|${r.role}|${r.failure.reason}`}>
            <h5>
              {fmt(j.noJourneyAt, {
                station: stationName(r.stationId, r.stationId, byId, lang),
                role: j.roles[r.role],
              })}
            </h5>
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
      })}
    </div>
  );
}
