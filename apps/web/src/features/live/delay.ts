/**
 * Delays and alerts for train legs, from the live feed and the timetable OTP gave (D-027). Pure.
 * The feeds carry absolute times, so a delay is the live time minus the scheduled time.
 */
import type { Lang } from '../../i18n';
import { stripFeed } from '../journey/otp';
import type { RideLeg } from '../journey/types';
import type { FeedState, LegLive, LiveAlert, LiveResponse, LiveStopTime, LiveText } from './types';

/** Under a minute counts as on time: the feeds are rounded to the minute anyway. */
export const ON_TIME_S = 60;

export const legKey = (leg: RideLeg): string => `${leg.route.id}@${leg.departure}`;

const iso = (epochS: number): string => new Date(epochS * 1000).toISOString();

const NONE: Omit<LegLive, 'feed' | 'ageSeconds'> = {
  trip: null,
  depDelayS: null,
  arrDelayS: null,
  liveDeparture: null,
  liveArrival: null,
  skippedBoard: false,
  skippedAlight: false,
};

/** What is known about one leg. `resp` is the operator's answer, null when there is none. */
export function computeLegLive(leg: RideLeg, feed: FeedState, resp: LiveResponse | null): LegLive {
  const ageSeconds = resp?.ageSeconds ?? null;
  // Stale data is not shown as fact: it could say "on time" for a train that has since been
  // delayed. The timetable stands, and the page says the feed is old.
  if (feed !== 'ok' || !resp || !leg.live) return { feed, ageSeconds, ...NONE };

  const trip = resp.trips[leg.live.tripId];
  if (!trip || trip.startDate !== leg.live.serviceDate) {
    return { feed, ageSeconds, ...NONE, trip: 'no_data' };
  }
  if (trip.canceled) return { feed, ageSeconds, ...NONE, trip: 'canceled' };

  const at = (seq: number): LiveStopTime | undefined => trip.stops.find((s) => s.seq === seq);
  const board = at(leg.live.fromSeq);
  const alight = at(leg.live.toSeq);
  const dep = board ? (board.departure ?? board.arrival) : null;
  const arr = alight ? (alight.arrival ?? alight.departure) : null;
  // The feed lists the stops still ahead of the train; one that has gone has no update.
  if (dep === null && arr === null && !board?.skipped && !alight?.skipped) {
    return { feed, ageSeconds, ...NONE, trip: 'no_data' };
  }
  return {
    feed,
    ageSeconds,
    trip: 'live',
    depDelayS: dep === null ? null : dep - Date.parse(leg.departure) / 1000,
    arrDelayS: arr === null ? null : arr - Date.parse(leg.arrival) / 1000,
    liveDeparture: dep === null ? null : iso(dep),
    liveArrival: arr === null ? null : iso(arr),
    skippedBoard: board?.skipped ?? false,
    skippedAlight: alight?.skipped ?? false,
  };
}

/** The delay to show for a leg (arrival at the stop you get off at, else departure), or null. */
export function headlineDelayS(l: LegLive): number | null {
  return l.arrDelayS ?? l.depDelayS;
}

/** Whole minutes late (+) or early (-), 0 when on time. */
export function delayMinutes(delayS: number): number {
  return Math.abs(delayS) < ON_TIME_S ? 0 : Math.round(delayS / 60);
}

// --- Alerts ---

const PREFERRED: Record<Lang, string[]> = {
  ja: ['ja', 'ja-JP', 'ja-Hrkt'],
  'ja-easy': ['ja-Hrkt', 'ja', 'ja-JP'],
  en: ['en', 'en-US'],
  'zh-Hant': ['zh-TW', 'zh-Hant', 'zh-HK', 'zh', 'en'],
};

/** The alert text in the page language; falls back to English, then to whatever there is. */
export function pickText(texts: readonly LiveText[], lang: Lang): string {
  const by = new Map(texts.map((t) => [t.language, t.text]));
  for (const code of [...PREFERRED[lang], 'en', 'ja']) {
    const hit = by.get(code);
    if (hit) return hit;
  }
  return texts[0]?.text ?? '';
}

/** An alert with no active period is always active (GTFS-RT). */
export function alertActive(a: LiveAlert, nowS: number): boolean {
  return (
    a.periods.length === 0 ||
    a.periods.some(
      (p) => (p.start === null || p.start <= nowS) && (p.end === null || nowS <= p.end),
    )
  );
}

/** An alert that names no route, trip or stop concerns the whole operator. */
export function alertConcerns(a: LiveAlert, leg: RideLeg): boolean {
  if (a.routeIds.length === 0 && a.tripIds.length === 0 && a.stopIds.length === 0) return true;
  const stops = [leg.from.stopId, leg.to.stopId, leg.from.stationId, leg.to.stationId];
  return (
    a.routeIds.includes(stripFeed(leg.route.id)) ||
    (leg.live ? a.tripIds.includes(leg.live.tripId) : false) ||
    a.stopIds.some((s) => stops.includes(s))
  );
}

export function alertsFor(leg: RideLeg, alerts: readonly LiveAlert[], nowS: number): LiveAlert[] {
  return alerts.filter((a) => alertActive(a, nowS) && alertConcerns(a, leg));
}
