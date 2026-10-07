import { assert, assertEquals } from "@std/assert";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { decodeAlerts, decodeTripUpdates } from "./feed.ts";
import { encode } from "./testutil.ts";

const rt = GtfsRealtimeBindings.transit_realtime;

const header = { gtfsRealtimeVersion: "2.0", timestamp: 1_791_366_408 };

Deno.test("decodes the real Toei sample: trips, service date, stop sequences, times", async () => {
  const bytes = await Deno.readFile(
    new URL("./fixtures/toei_trip_update.sample.pb", import.meta.url),
  );
  const snap = decodeTripUpdates(bytes);
  assertEquals(snap.feedTimestamp, 1_791_366_408);
  assertEquals([...snap.trips.keys()], ["101773H0", "101785H0", "101805H0", "101825N0"]);
  const trip = snap.trips.get("101773H0")!;
  assertEquals(trip.startDate, "20261007");
  assertEquals(trip.canceled, false);
  assertEquals(trip.stops[0].seq, 1);
  assertEquals(trip.stops[0].departure, 1_791_365_066); // as in the live feed when it was recorded
  assert(trip.stops.every((s) => s.seq > 0 && !s.skipped));
});

Deno.test("a cancelled trip and a skipped stop are marked, not dropped", () => {
  const snap = decodeTripUpdates(encode({
    header,
    entity: [
      {
        id: "a",
        tripUpdate: {
          trip: {
            tripId: "T1",
            startDate: "20261007",
            scheduleRelationship: rt.TripDescriptor.ScheduleRelationship.CANCELED,
          },
        },
      },
      {
        id: "b",
        tripUpdate: {
          trip: { tripId: "T2", startDate: "20261007" },
          stopTimeUpdate: [
            { stopSequence: 3, departure: { time: 1_791_365_000 } },
            {
              stopSequence: 4,
              scheduleRelationship: rt.TripUpdate.StopTimeUpdate.ScheduleRelationship.SKIPPED,
            },
          ],
        },
      },
    ],
  }));
  assertEquals(snap.trips.get("T1")!.canceled, true);
  const stops = snap.trips.get("T2")!.stops;
  assertEquals(stops.map((s) => [s.seq, s.skipped, s.arrival, s.departure]), [
    [3, false, null, 1_791_365_000],
    [4, true, null, null],
  ]);
});

Deno.test("entities without a trip id or stop sequence are ignored", () => {
  const snap = decodeTripUpdates(encode({
    header,
    entity: [
      { id: "x", tripUpdate: { trip: {}, stopTimeUpdate: [] } },
      {
        id: "y",
        tripUpdate: { trip: { tripId: "T" }, stopTimeUpdate: [{ departure: { time: 5 } }] },
      },
    ],
  }));
  assertEquals(snap.trips.get("T")!.stops, []);
  assertEquals(snap.trips.size, 1);
});

Deno.test("a stop_sequence of 0 that was really sent is kept", () => {
  const snap = decodeTripUpdates(encode({
    header,
    entity: [{
      id: "z",
      tripUpdate: {
        trip: { tripId: "T" },
        stopTimeUpdate: [{ stopSequence: 0, departure: { time: 7 } }, { departure: { time: 8 } }],
      },
    }],
  }));
  assertEquals(snap.trips.get("T")!.stops.map((s) => [s.seq, s.departure]), [[0, 7]]);
});

Deno.test("alerts: texts in each language, cause, effect, targets and active periods", () => {
  const snap = decodeAlerts(encode({
    header,
    entity: [{
      id: "alert-1",
      alert: {
        cause: rt.Alert.Cause.TECHNICAL_PROBLEM,
        effect: rt.Alert.Effect.SIGNIFICANT_DELAYS,
        headerText: {
          translation: [{ text: "遅延", language: "ja" }, { text: "Delays", language: "en" }],
        },
        descriptionText: { translation: [{ text: "信号故障", language: "ja" }] },
        informedEntity: [{ routeId: "4" }, { routeId: "4" }, { stopId: "421" }, {
          trip: { tripId: "T1" },
        }],
        activePeriod: [{ start: 1_791_360_000 }],
      },
    }],
  }));
  assertEquals(snap.alerts.length, 1);
  const a = snap.alerts[0];
  assertEquals([a.id, a.cause, a.effect], ["alert-1", "TECHNICAL_PROBLEM", "SIGNIFICANT_DELAYS"]);
  assertEquals(a.header, [{ language: "ja", text: "遅延" }, { language: "en", text: "Delays" }]);
  assertEquals([a.routeIds, a.stopIds, a.tripIds], [["4"], ["421"], ["T1"]]);
  assertEquals(a.periods, [{ start: 1_791_360_000, end: null }]);
});

Deno.test("an empty alert feed (header only, as Toei sends when all is well) is no alerts", () => {
  assertEquals(decodeAlerts(encode({ header })).alerts, []);
});
