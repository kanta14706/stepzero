// Decoding of GTFS-Realtime feeds into the small shapes the app needs. Pure: bytes in, data out.
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const rt = GtfsRealtimeBindings.transit_realtime;

export interface StopTime {
  seq: number; // GTFS stop_sequence; OTP's stopPosition for the same stop (Toei: 1..n, no gaps)
  arrival: number | null; // epoch seconds
  departure: number | null;
  skipped: boolean; // the train does not stop here
}

export interface LiveTrip {
  startDate: string; // YYYYMMDD service date
  canceled: boolean;
  stops: StopTime[];
}

export interface Text {
  language: string;
  text: string;
}

export interface LiveAlert {
  id: string;
  cause: string;
  effect: string;
  header: Text[];
  description: Text[];
  routeIds: string[];
  tripIds: string[];
  stopIds: string[];
  periods: { start: number | null; end: number | null }[];
}

export interface TripSnapshot {
  feedTimestamp: number | null; // epoch seconds, from the feed header
  trips: Map<string, LiveTrip>; // by GTFS trip_id
}

export interface AlertSnapshot {
  feedTimestamp: number | null;
  alerts: LiveAlert[];
}

// int64 fields arrive as number, bigint or Long depending on the value
// deno-lint-ignore no-explicit-any -- protobufjs Long has no exported type here
function num(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : typeof v.toNumber === "function" ? v.toNumber() : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function decode(bytes: Uint8Array) {
  return rt.FeedMessage.decode(bytes);
}

export function decodeTripUpdates(bytes: Uint8Array): TripSnapshot {
  const msg = decode(bytes);
  const trips = new Map<string, LiveTrip>();
  for (const e of msg.entity) {
    const tu = e.tripUpdate;
    const tripId = tu?.trip?.tripId;
    if (!tu || !tripId) continue;
    trips.set(tripId, {
      startDate: tu.trip.startDate ?? "",
      canceled: tu.trip.scheduleRelationship === rt.TripDescriptor.ScheduleRelationship.CANCELED,
      stops: (tu.stopTimeUpdate ?? [])
        // an absent stop_sequence reads as 0 (protobuf default), and 0 is a valid sequence in
        // some feeds, so test that the field was really sent
        .filter((u) => Object.hasOwn(u, "stopSequence"))
        .map((u) => ({
          seq: u.stopSequence as number,
          arrival: num(u.arrival?.time),
          departure: num(u.departure?.time),
          skipped: u.scheduleRelationship ===
            rt.TripUpdate.StopTimeUpdate.ScheduleRelationship.SKIPPED,
        })),
    });
  }
  return { feedTimestamp: num(msg.header.timestamp), trips };
}

function texts(ts: GtfsRealtimeBindings.transit_realtime.ITranslatedString | null | undefined) {
  return (ts?.translation ?? []).map((t) => ({ language: t.language ?? "", text: t.text }));
}

export function decodeAlerts(bytes: Uint8Array): AlertSnapshot {
  const msg = decode(bytes);
  const alerts: LiveAlert[] = [];
  for (const e of msg.entity) {
    const a = e.alert;
    if (!a) continue;
    const entities = a.informedEntity ?? [];
    alerts.push({
      id: e.id,
      cause: rt.Alert.Cause[a.cause ?? 1] ?? "UNKNOWN_CAUSE",
      effect: rt.Alert.Effect[a.effect ?? 8] ?? "UNKNOWN_EFFECT",
      header: texts(a.headerText),
      description: texts(a.descriptionText),
      routeIds: unique(entities.map((i) => i.routeId)),
      tripIds: unique(entities.map((i) => i.trip?.tripId)),
      stopIds: unique(entities.map((i) => i.stopId)),
      periods: (a.activePeriod ?? []).map((p) => ({ start: num(p.start), end: num(p.end) })),
    });
  }
  return { feedTimestamp: num(msg.header.timestamp), alerts };
}

function unique(xs: (string | null | undefined)[]): string[] {
  return [...new Set(xs.filter((x): x is string => !!x))];
}
