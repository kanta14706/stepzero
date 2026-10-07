import { useMemo } from 'react';
import { fmt, useI18n } from '../../i18n';
import type { Lang } from '../../i18n';
import type { Dictionary } from '../../i18n/ja';
import { stationHref } from '../../router';
import { routeToSteps } from '../../routing/steps';
import type { ProfileId } from '../../routing/types';
import { StepReport, reportTime } from '../report/ReportControls';
import type { SendReport } from '../report/ReportControls';
import { boardingNotes, describeStep, nameIn, roundMetres } from '../station-view/describe';
import { MARGIN_S } from './assemble';
import type { Journey, RideLeg, Segment, Station } from './types';
import { TierBadge } from '../../components/TierBadge';
import { LiveBar } from '../live/LiveBar';
import { LiveLeg } from '../live/LiveLeg';
import { legKey } from '../live/delay';
import { transferRisks } from '../live/transfers';
import type { JourneyLive } from '../live/useLiveStatus';

export const minutes = (s: number): number => Math.max(1, Math.round(s / 60));

/** Line name in the page language, from the station list (OTP only has the Japanese name). */
export function lineName(
  leg: RideLeg,
  stations: ReadonlyMap<string, Station>,
  lang: string,
): string {
  for (const id of [leg.from.stationId, leg.to.stationId]) {
    const line = id ? stations.get(id)?.lines.find((l) => l.id === leg.route.id) : undefined;
    if (line) return nameIn(line.name, lang);
  }
  return leg.route.name;
}

export function stationName(
  id: string | null,
  fallback: string,
  stations: ReadonlyMap<string, Station>,
  lang: string,
): string {
  const s = id ? stations.get(id) : undefined;
  return s ? nameIn(s.name, lang) : fallback;
}

/** Stop names in the page language (the station list has English names; OTP has Japanese). */
function headsignIn(headsign: string, stations: readonly Station[], lang: string): string {
  const hit = stations.find((s) => s.name['ja'] === headsign);
  return hit ? nameIn(hit.name, lang) : headsign;
}

export function journeySummary(
  journey: Journey,
  t: Dictionary,
  lang: Lang,
): { times: string; facts: string } {
  const j = t.journey;
  const start = journey.leaveAt ?? journey.firstDeparture;
  const min = minutes((Date.parse(journey.arriveAt) - Date.parse(start)) / 1000);
  const values = { dep: reportTime(start, lang), arr: reportTime(journey.arriveAt, lang), min };
  return {
    times: fmt(journey.leaveAt ? j.optionSummary : j.optionDepartOnly, values),
    facts: fmt(j.optionFacts, { transfers: journey.rides - 1, lifts: journey.elevatorRides }),
  };
}

interface TimelineProps {
  journey: Journey;
  stations: readonly Station[];
  profile: ProfileId;
  onReport?: SendReport | undefined;
  reportBusy: boolean;
  /** Live delays and alerts for the trains (step 2.7); absent: no live information. */
  live?: JourneyLive | undefined;
  /** Plan again from now. */
  onReplan?: (() => void) | undefined;
}

/** One journey as an ordered list: street, stations (with their steps), trains. */
export function JourneyTimeline({
  journey,
  stations,
  profile,
  onReport,
  reportBusy,
  live,
  onReplan,
}: TimelineProps) {
  const { t, lang } = useI18n();
  const byId = useMemo(() => new Map(stations.map((s) => [s.id, s])), [stations]);
  const j = t.journey;
  const risks = useMemo(() => (live ? transferRisks(journey, live.byLeg) : []), [journey, live]);
  const nameOf = (id: string | null, fallback: string) => stationName(id, fallback, byId, lang);
  return (
    <>
      {live && <LiveBar live={live} risks={risks} stationName={nameOf} onReplan={onReplan} />}
      <p>
        {journey.leaveAt ? `${fmt(j.leaveAt, { time: reportTime(journey.leaveAt, lang) })} → ` : ''}
        {fmt(j.arriveAt, { time: reportTime(journey.arriveAt, lang) })}
      </p>
      {!journey.leaveAt && <p className="hint">{j.leaveUnknown}</p>}
      <p className="hint">{fmt(j.timesNote, { margin: minutes(MARGIN_S) })}</p>
      <ol className="timeline">
        {journey.segments.map((seg, i) => (
          <li
            key={i}
            className="timeline-item"
            data-segment={seg.kind}
            data-role={'role' in seg ? seg.role : undefined}
          >
            <SegmentView
              seg={seg}
              journey={journey}
              stations={stations}
              byId={byId}
              profile={profile}
              onReport={onReport}
              reportBusy={reportBusy}
              live={live}
            />
          </li>
        ))}
      </ol>
    </>
  );
}

function SegmentView({
  seg,
  journey,
  stations,
  byId,
  profile,
  onReport,
  reportBusy,
  live,
}: {
  seg: Segment;
  journey: Journey;
  stations: readonly Station[];
  byId: ReadonlyMap<string, Station>;
  profile: ProfileId;
  onReport?: SendReport | undefined;
  reportBusy: boolean;
  live: JourneyLive | undefined;
}) {
  const { t, lang } = useI18n();
  const j = t.journey;
  const name = (id: string | null, fallback = '') => stationName(id, fallback, byId, lang);

  switch (seg.kind) {
    case 'street': {
      const values = {
        place: seg.place.label,
        station: name(
          seg.role === 'access'
            ? (journey.segments.find((s) => s.kind === 'station')?.stationId ?? null)
            : ([...journey.segments].reverse().find((s) => s.kind === 'station')?.stationId ??
                null),
        ),
        m: roundMetres(seg.distanceM),
        min: minutes(seg.seconds),
      };
      return (
        <>
          <p>{fmt(seg.role === 'access' ? j.streetAccess : j.streetEgress, values)}</p>
          <p className="step-note">{seg.source === 'otp' ? j.streetOsm : j.streetStraight}</p>
        </>
      );
    }

    case 'walk':
      return (
        <p>
          {fmt(j.walkTransfer, {
            from: name(seg.leg.from.stationId, seg.leg.from.name),
            to: name(seg.leg.to.stationId, seg.leg.to.name),
            m: roundMetres(seg.leg.distanceM),
            min: minutes(seg.leg.seconds),
          })}
        </p>
      );

    case 'ride': {
      const leg = seg.leg;
      const line = lineName(leg, byId, lang);
      const a = seg.advice;
      const parts = t.steps.parts;
      return (
        <>
          <h4>
            {leg.route.color && (
              <span
                className="line-mark"
                style={{ background: leg.route.color }}
                aria-hidden="true"
              />
            )}
            {leg.headsign
              ? fmt(j.rideTitle, { line, headsign: headsignIn(leg.headsign, stations, lang) })
              : fmt(j.rideNoHeadsign, { line })}
          </h4>
          <p>
            {fmt(j.rideTimes, {
              from: name(leg.from.stationId, leg.from.name),
              dep: reportTime(leg.departure, lang),
              to: name(leg.to.stationId, leg.to.name),
              arr: reportTime(leg.arrival, lang),
              stops: leg.stops + 1,
            })}
          </p>
          {live && (
            <LiveLeg
              leg={leg}
              live={live.byLeg.get(legKey(leg))}
              alerts={live.alerts.get(legKey(leg)) ?? []}
              stationName={name}
            />
          )}
          {a && (
            <>
              <p className="ride-advice">
                {fmt(a.purpose === 'exit' ? j.rideAdviceExit : j.rideAdviceTransfer, {
                  part: parts[a.position.part],
                  station: name(a.stationId),
                })}
              </p>
              {a.position.confidence === 'weak' && (
                <p className="step-note">{t.steps.boardingWeak}</p>
              )}
              {a.position.approximate && <p className="step-note">{t.steps.boardingApproximate}</p>}
              <p className="step-note">{t.steps.boardingNoCar}</p>
            </>
          )}
        </>
      );
    }

    case 'station': {
      const title = fmt(
        seg.role === 'access'
          ? j.accessTitle
          : seg.role === 'transfer'
            ? j.transferTitle
            : j.egressTitle,
        { station: name(seg.stationId, seg.stationId) },
      );
      if (seg.tier === 1) {
        return (
          <>
            <h4>{title}</h4>
            <p>
              <TierBadge tier={1} explain={false} />
            </p>
            <p className="notice-inline tier1-note">{j.tier1}</p>
          </>
        );
      }
      return (
        <StationSteps
          seg={seg}
          title={title}
          tight={seg.role === 'transfer' && journey.tightTransfers.includes(seg.stationId)}
          profile={profile}
          onReport={onReport}
          reportBusy={reportBusy}
        />
      );
    }
  }
}

function StationSteps({
  seg,
  title,
  tight,
  profile,
  onReport,
  reportBusy,
}: {
  seg: Extract<Segment, { kind: 'station'; tier: 2 }>;
  title: string;
  tight: boolean;
  profile: ProfileId;
  onReport?: SendReport | undefined;
  reportBusy: boolean;
}) {
  const { t, lang } = useI18n();
  const j = t.journey;
  const steps = useMemo(() => routeToSteps(seg.index, seg.route), [seg.index, seg.route]);
  const { summary, legs } = seg.route;
  return (
    <>
      <h4>{title}</h4>
      <p>
        <TierBadge tier={2} explain={false} />
      </p>
      <p>
        {fmt(j.inStation, {
          m: roundMetres(summary.lengthM),
          min: minutes(summary.seconds),
          lifts: summary.elevators,
        })}
      </p>
      {tight && <p className="notice-inline">{j.tight}</p>}
      <ol className="steps">
        {steps.map((step, i) => {
          const described = describeStep(step, t, profile, lang);
          // Where to ride is said on the train itself; do not repeat it where the route leaves
          // the platform.
          const repeated =
            seg.role !== 'access' &&
            step.kind === 'start' &&
            step.place.type === 'platform' &&
            step.place.boarding
              ? new Set(boardingNotes(step.place.boarding, 'start', t, lang))
              : null;
          const text = described.text;
          const notes = repeated
            ? described.notes.filter((n) => !repeated.has(n))
            : described.notes;
          const device =
            onReport && (step.kind === 'elevator' || step.kind === 'escalator')
              ? legs.slice(step.legStart, step.legEnd).find((l) => l.edge.mode === step.kind)?.edge
                  .id
              : undefined;
          return (
            <li key={i} data-kind={step.kind}>
              <span>{text}</span>
              {notes.map((n) => (
                <span key={n} className="step-note">
                  {n}
                </span>
              ))}
              {device && onReport && (step.kind === 'elevator' || step.kind === 'escalator') && (
                <div className="step-actions">
                  <StepReport
                    mode={step.kind}
                    stepNumber={i + 1}
                    busy={reportBusy}
                    onSend={(status) => {
                      onReport(device, status);
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <p>
        <a href={stationHref(seg.stationId)}>
          {fmt(j.stationPage, { station: nameIn(seg.index.graph.station.name, lang) })}
        </a>
      </p>
    </>
  );
}
