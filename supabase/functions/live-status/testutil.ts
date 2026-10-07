import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const rt = GtfsRealtimeBindings.transit_realtime;

/** Build a GTFS-RT message in the tests (synthetic cases; the real sample is in fixtures/). */
export function encode(message: GtfsRealtimeBindings.transit_realtime.IFeedMessage): Uint8Array {
  return rt.FeedMessage.encode(rt.FeedMessage.create(message)).finish();
}
