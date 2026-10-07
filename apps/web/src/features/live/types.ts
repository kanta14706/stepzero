/** Shapes of the `live-status` edge function's answer (supabase/functions/live-status, D-027). */

export interface LiveStopTime {
  /** GTFS stop_sequence, the same number as OTP's stopPosition. */
  seq: number;
  /** Epoch seconds; null when the feed gave none. */
  arrival: number | null;
  departure: number | null;
  /** The train does not stop here. */
  skipped: boolean;
}

export interface LiveTrip {
  /** YYYYMMDD service day. */
  startDate: string;
  canceled: boolean;
  stops: LiveStopTime[];
}

export interface LiveText {
  language: string;
  text: string;
}

export interface LiveAlert {
  id: string;
  cause: string;
  effect: string;
  header: LiveText[];
  description: LiveText[];
  routeIds: string[];
  tripIds: string[];
  stopIds: string[];
  periods: { start: number | null; end: number | null }[];
}

export interface LiveResponse {
  operator: string;
  feedId: string;
  /** stale: the feed stopped updating, or the last refresh failed and this is the last good copy. */
  status: 'ok' | 'stale';
  feedTimestamp: string;
  ageSeconds: number;
  /** Only the requested trips that the feed knows: the feed holds trains running now. */
  trips: Record<string, LiveTrip>;
  tripCount: number;
  alertsStatus: 'ok' | 'stale' | 'unavailable' | 'none';
  alerts: LiveAlert[];
}

/** Why a leg has no live information to show. */
export type FeedState =
  'ok' | 'stale' | 'unavailable' | 'not_covered' | 'not_configured' | 'offline' | 'loading';

/** What is known about one train leg right now. Delays are live time minus timetable time. */
export interface LegLive {
  feed: FeedState;
  /** Age of the feed's own timestamp, when there was an answer. */
  ageSeconds: number | null;
  /** live: the feed has the train; no_data: it is not in the feed (yet); null: no usable answer. */
  trip: 'live' | 'canceled' | 'no_data' | null;
  depDelayS: number | null;
  arrDelayS: number | null;
  /** ISO times from the feed. */
  liveDeparture: string | null;
  liveArrival: string | null;
  skippedBoard: boolean;
  skippedAlight: boolean;
}
