/** Builders for the live-status tests. */
import type { Journey, OtpStop, RideLeg, Segment } from '../journey/types';
import type { LegLive, LiveAlert, LiveResponse, LiveStopTime, LiveTrip } from './types';

export const DEP = '2026-10-07T09:00:00+09:00';
export const ARR = '2026-10-07T09:20:00+09:00';
export const epoch = (iso: string): number => Date.parse(iso) / 1000;

const stop = (id: string): OtpStop => ({
  name: id,
  lat: 0,
  lon: 0,
  stopId: `${id}P1`,
  stationId: id,
  platformCode: null,
});

export function ride(over: Partial<RideLeg> = {}): RideLeg {
  return {
    kind: 'ride',
    mode: 'SUBWAY',
    route: { id: '1:4', name: '大江戸線', color: null },
    headsign: null,
    from: stop('428'),
    to: stop('421'),
    departure: DEP,
    arrival: ARR,
    stops: 5,
    distanceM: 1000,
    live: { feedId: '1', tripId: 'T1', serviceDate: '20261007', fromSeq: 3, toSeq: 9 },
    ...over,
  };
}

export const stopTime = (seq: number, over: Partial<LiveStopTime> = {}): LiveStopTime => ({
  seq,
  arrival: null,
  departure: null,
  skipped: false,
  ...over,
});

export function trip(stops: LiveStopTime[], over: Partial<LiveTrip> = {}): LiveTrip {
  return { startDate: '20261007', canceled: false, stops, ...over };
}

export function response(
  trips: Record<string, LiveTrip>,
  over: Partial<LiveResponse> = {},
): LiveResponse {
  return {
    operator: 'toei',
    feedId: '1',
    status: 'ok',
    feedTimestamp: '2026-10-07T00:00:00.000Z',
    ageSeconds: 5,
    trips,
    tripCount: Object.keys(trips).length,
    alertsStatus: 'ok',
    alerts: [],
    ...over,
  };
}

/** A train that is `lateS` seconds late at boarding and at getting off. */
export const lateTrip = (lateS: number): LiveTrip =>
  trip([
    stopTime(3, { departure: epoch(DEP) + lateS }),
    stopTime(9, { arrival: epoch(ARR) + lateS }),
  ]);

export function alert(over: Partial<LiveAlert> = {}): LiveAlert {
  return {
    id: 'a1',
    cause: 'TECHNICAL_PROBLEM',
    effect: 'SIGNIFICANT_DELAYS',
    header: [{ language: 'ja', text: '遅延' }],
    description: [],
    routeIds: [],
    tripIds: [],
    stopIds: [],
    periods: [],
    ...over,
  };
}

export function legLive(over: Partial<LegLive> = {}): LegLive {
  return {
    feed: 'ok',
    ageSeconds: 5,
    trip: 'live',
    depDelayS: null,
    arrDelayS: null,
    liveDeparture: null,
    liveArrival: null,
    skippedBoard: false,
    skippedAlight: false,
    ...over,
  };
}

/** A journey of the given segments; only the segments matter to the live logic. */
export function journey(segments: Segment[]): Journey {
  const rides = segments.filter((s) => s.kind === 'ride').length;
  return {
    segments,
    leaveAt: null,
    firstDeparture: DEP,
    arriveAt: ARR,
    rides,
    elevatorRides: 0,
    unverifiedStations: [],
    tightTransfers: [],
    itinerary: { start: DEP, end: ARR, legs: [] },
  };
}
