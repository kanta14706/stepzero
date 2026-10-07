import type { Journey, RideLeg } from '../journey/types';
import { ON_TIME_S, legKey } from './delay';
import type { LegLive } from './types';

export interface TransferRisk {
  /** The station where the change is made. */
  stationId: string | null;
  /** late: the first train arrives too late for the second; canceled: the second is cancelled. */
  reason: 'late' | 'canceled';
}

/**
 * Changes that live information puts in doubt. OTP planned them on the timetable, so a late train
 * can make a change it showed as fine impossible. Only delays that cause the problem are reported:
 * a change that is tight on the timetable already says so (`tightTransfers`).
 */
export function transferRisks(
  journey: Journey,
  live: ReadonlyMap<string, LegLive>,
): TransferRisk[] {
  const risks: TransferRisk[] = [];
  const segs = journey.segments;
  for (let i = 0; i < segs.length; i++) {
    const a = segs[i];
    if (a?.kind !== 'ride') continue;
    // Everything between two trains is the change: an in-station route, or, between two different
    // stations, a station, OTP's walk and the other station (three segments), or nothing at all.
    let j = i + 1;
    let seconds = 0;
    for (let seg = segs[j]; seg; seg = segs[++j]) {
      if (seg.kind === 'walk') seconds += seg.leg.seconds;
      else if (seg.kind === 'station' && seg.role === 'transfer') {
        seconds += seg.tier === 2 ? seg.route.summary.seconds : (seg.walk?.seconds ?? 0);
      } else break;
    }
    const b = segs[j];
    if (b?.kind !== 'ride') continue;
    const at: RideLeg = a.leg;

    const la = live.get(legKey(at));
    const lb = live.get(legKey(b.leg));
    const stationId = at.to.stationId;
    if (lb?.trip === 'canceled') {
      risks.push({ stationId, reason: 'canceled' });
      continue;
    }
    if (la?.trip !== 'live' || la.arrDelayS === null || la.arrDelayS < ON_TIME_S) continue;
    const arrives = Date.parse(la.liveArrival ?? at.arrival) + seconds * 1000;
    const leaves = Date.parse(lb?.liveDeparture ?? b.leg.departure);
    if (arrives > leaves) risks.push({ stationId, reason: 'late' });
  }
  return risks;
}
