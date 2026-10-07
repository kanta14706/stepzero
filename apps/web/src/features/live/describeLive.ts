import { fmt } from '../../i18n';
import type { Lang } from '../../i18n';
import type { Dictionary } from '../../i18n/ja';
import type { RideLeg } from '../journey/types';
import { reportTime } from '../report/ReportControls';
import { delayMinutes, headlineDelayS } from './delay';
import type { LegLive } from './types';

/**
 * How a train's live state is worded. The state is for styling and tests; the wording always
 * carries the meaning, so nothing depends on colour.
 */
export type LiveTone = 'loading' | 'on_time' | 'late' | 'early' | 'canceled' | 'info';

export interface LiveDescription {
  tone: LiveTone;
  lines: string[];
}

export function describeLive(
  l: LegLive,
  leg: RideLeg,
  t: Dictionary,
  lang: Lang,
  stationName: (id: string | null, fallback: string) => string,
): LiveDescription {
  const s = t.live;
  switch (l.feed) {
    case 'loading':
      return { tone: 'loading', lines: [s.checking] };
    case 'not_covered':
      return { tone: 'info', lines: [s.notCovered] };
    case 'not_configured':
      return { tone: 'info', lines: [s.notConfigured] };
    case 'unavailable':
      return { tone: 'info', lines: [s.unavailable] };
    case 'offline':
      return { tone: 'info', lines: [s.offline] };
    case 'stale':
      return {
        tone: 'info',
        lines: [fmt(s.stale, { min: Math.max(1, Math.round((l.ageSeconds ?? 0) / 60)) })],
      };
    case 'ok':
      break;
  }
  if (l.trip === 'canceled') return { tone: 'canceled', lines: [s.canceled] };
  if (l.trip !== 'live') return { tone: 'info', lines: [s.noData] };

  const lines: string[] = [];
  if (l.skippedBoard) {
    lines.push(fmt(s.skippedBoard, { station: stationName(leg.from.stationId, leg.from.name) }));
  }
  if (l.skippedAlight) {
    lines.push(fmt(s.skippedAlight, { station: stationName(leg.to.stationId, leg.to.name) }));
  }
  const delay = headlineDelayS(l);
  if (delay === null) return { tone: lines.length > 0 ? 'canceled' : 'info', lines };
  const min = delayMinutes(delay);
  if (min === 0)
    return { tone: lines.length > 0 ? 'canceled' : 'on_time', lines: [...lines, s.onTime] };

  const time = (iso: string | null): string => (iso ? reportTime(iso, lang) : '');
  const sched = { dep: time(leg.departure), arr: time(leg.arrival) };
  const when =
    l.liveDeparture && l.liveArrival
      ? fmt(s.newTimes, {
          dep: time(l.liveDeparture),
          arr: time(l.liveArrival),
          schedDep: sched.dep,
          schedArr: sched.arr,
        })
      : l.liveArrival
        ? fmt(s.newArrival, { arr: time(l.liveArrival), sched: sched.arr })
        : fmt(s.newDeparture, { dep: time(l.liveDeparture), sched: sched.dep });
  return {
    tone: min > 0 ? 'late' : 'early',
    lines: [...lines, fmt(min > 0 ? s.late : s.early, { min: Math.abs(min) }), when],
  };
}
