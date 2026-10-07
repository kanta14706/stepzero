import { describe, expect, it } from 'vitest';
import type { Segment } from '../journey/types';
import { legKey } from './delay';
import { transferRisks } from './transfers';
import { ARR, epoch, journey, legLive, ride } from './testing';

const A = ride({
  route: { id: '1:4', name: 'A', color: null },
  departure: '2026-10-07T09:00:00+09:00',
  arrival: ARR,
});
// B leaves 5 minutes after A arrives; the change takes 3 minutes in the station
const B = ride({
  route: { id: '1:5', name: 'B', color: null },
  departure: '2026-10-07T09:25:00+09:00',
  arrival: '2026-10-07T09:45:00+09:00',
});
const change: Segment = {
  kind: 'station',
  role: 'transfer',
  stationId: '421',
  tier: 1,
  walk: {
    kind: 'walk',
    from: A.to,
    to: B.from,
    departure: ARR,
    arrival: ARR,
    distanceM: 100,
    seconds: 180,
  },
};
const j = journey([
  { kind: 'ride', leg: A, advice: null },
  change,
  { kind: 'ride', leg: B, advice: null },
]);

const live = (aLate: number, b: Partial<ReturnType<typeof legLive>> = {}) =>
  new Map([
    [
      legKey(A),
      legLive({
        arrDelayS: aLate,
        liveArrival: new Date((epoch(ARR) + aLate) * 1000).toISOString(),
      }),
    ],
    [legKey(B), legLive(b)],
  ]);

describe('transferRisks', () => {
  it('is empty when the trains run on time', () => {
    expect(transferRisks(j, live(0))).toEqual([]);
  });

  it('is empty when the delay still leaves time for the change', () => {
    expect(transferRisks(j, live(60))).toEqual([]); // arrives 09:21 + 3 min < 09:25
  });

  it('warns when the delay eats the time for the change', () => {
    expect(transferRisks(j, live(240))).toEqual([{ stationId: A.to.stationId, reason: 'late' }]);
  });

  it('counts the second train being late too, which gives the change more time', () => {
    const later = new Date(epoch('2026-10-07T09:25:00+09:00') * 1000 + 600_000).toISOString();
    expect(transferRisks(j, live(240, { liveDeparture: later, trip: 'live' }))).toEqual([]);
  });

  it('warns when the train to change to is cancelled', () => {
    expect(transferRisks(j, live(0, { trip: 'canceled' }))).toEqual([
      { stationId: A.to.stationId, reason: 'canceled' },
    ]);
  });

  it('says nothing for a journey with one train, or with no live data', () => {
    expect(transferRisks(journey([{ kind: 'ride', leg: A, advice: null }]), live(900))).toEqual([]);
    expect(transferRisks(j, new Map())).toEqual([]);
  });
});
