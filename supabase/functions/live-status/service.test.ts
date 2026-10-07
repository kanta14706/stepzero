import { assert, assertEquals, assertFalse } from "@std/assert";
import { encode } from "./testutil.ts";
import { createService, type Deps, FRESH_MS, MAX_TRIPS, STALE_AFTER_S } from "./service.ts";

const NOW = 1_791_366_500_000; // ms
const feedAt = (ageS: number) => ({ gtfsRealtimeVersion: "2.0", timestamp: NOW / 1000 - ageS });

function tripFeed(ageS = 5) {
  return encode({
    header: feedAt(ageS),
    entity: [{
      id: "1",
      tripUpdate: {
        trip: { tripId: "T1", startDate: "20261007" },
        stopTimeUpdate: [{ stopSequence: 2, departure: { time: NOW / 1000 + 60 } }],
      },
    }, {
      id: "2",
      tripUpdate: { trip: { tripId: "T2", startDate: "20261007" }, stopTimeUpdate: [] },
    }],
  });
}

const EMPTY_ALERTS = encode({ header: feedAt(5) });

/** Fake upstream: serves `routes` by url suffix, counts fetches, can be made to fail. */
function harness(opts: { ageS?: number; env?: Record<string, string> } = {}) {
  const state = {
    now: NOW,
    fetches: [] as string[],
    failing: false,
    tripBytes: tripFeed(opts.ageS),
  };
  const deps: Deps = {
    fetchBytes(url) {
      state.fetches.push(url);
      if (state.failing) return Promise.reject(new Error(`boom ${url}`)); // an error that holds the url
      return Promise.resolve(url.includes("trip_update") ? state.tripBytes : EMPTY_ALERTS);
    },
    now: () => state.now,
    env: (n) => opts.env?.[n],
  };
  const service = createService(deps);
  const get = async (qs: string) => {
    const res = await service.handle(new Request(`https://x.test/live-status?${qs}`));
    return { status: res.status, body: await res.json() };
  };
  return { state, get, service };
}

Deno.test("returns only the requested trips that have live data", async () => {
  const { get } = harness();
  const { status, body } = await get("operator=toei&trips=T1,NOPE");
  assertEquals(status, 200);
  assertEquals(body.status, "ok");
  assertEquals(Object.keys(body.trips), ["T1"]);
  assertEquals(body.trips.T1.stops[0].seq, 2);
  assertEquals(body.tripCount, 2);
  assertEquals(body.feedId, "1");
  assertEquals(body.alertsStatus, "ok");
  assertEquals(body.alerts, []);
});

Deno.test("rejects unknown operators, bad trip ids and too many trips", async () => {
  const { get } = harness();
  assertEquals((await get("operator=nope")).status, 400);
  assertEquals((await get("operator=toei&trips=a%2Fb")).body.error, "bad_trip_id");
  const many = Array.from({ length: MAX_TRIPS + 1 }, (_, i) => `T${i}`).join(",");
  assertEquals((await get(`operator=toei&trips=${many}`)).body.error, "too_many_trips");
  assertEquals((await get("operator=__proto__")).status, 400);
});

Deno.test("a feed whose own timestamp is old is reported stale, not ok", async () => {
  const { get } = harness({ ageS: STALE_AFTER_S + 30 });
  const { body } = await get("operator=toei&trips=T1");
  assertEquals(body.status, "stale");
  assert(body.ageSeconds > STALE_AFTER_S);
});

Deno.test("one upstream fetch per feed inside the cache window, a new one after it", async () => {
  const { get, state } = harness();
  await Promise.all([
    get("operator=toei&trips=T1"),
    get("operator=toei&trips=T2"),
    get("operator=toei"),
  ]);
  assertEquals(state.fetches.length, 2); // trip updates + alerts, shared by all three requests
  await get("operator=toei&trips=T1");
  assertEquals(state.fetches.length, 2);
  state.now += FRESH_MS + 1;
  await get("operator=toei&trips=T1");
  assertEquals(state.fetches.length, 4);
});

Deno.test("when a refresh fails the last good copy is served and marked stale", async () => {
  const { get, state } = harness();
  assertEquals((await get("operator=toei&trips=T1")).body.status, "ok");
  state.failing = true;
  state.now += FRESH_MS + 1;
  const { status, body } = await get("operator=toei&trips=T1");
  assertEquals(status, 200);
  assertEquals(body.status, "stale");
  assertEquals(Object.keys(body.trips), ["T1"]);
});

Deno.test("with no copy at all and the upstream down it says unavailable (502), not empty", async () => {
  const { get, state } = harness();
  state.failing = true;
  const { status, body } = await get("operator=toei&trips=T1");
  assertEquals(status, 502);
  assertEquals(body.status, "unavailable");
});

Deno.test("a failing alert feed does not take the trip updates down", async () => {
  const real = tripFeed();
  const service = createService({
    fetchBytes: (url) =>
      url.includes("alert") ? Promise.reject(new Error("x")) : Promise.resolve(real),
    now: () => NOW,
    env: () => undefined,
  });
  const res = await service.handle(
    new Request("https://x.test/live-status?operator=toei&trips=T1"),
  );
  const body = await res.json();
  assertEquals([res.status, body.status, body.alertsStatus], [200, "ok", "unavailable"]);
});

Deno.test("the challenge key is used upstream but never returned or logged", async () => {
  const KEY = "SECRET-KEY-123";
  const { get, state } = harness({ env: { ODPT_CHALLENGE_KEY: KEY } });
  const { body } = await get("operator=keio&trips=T1");
  assert(state.fetches.every((u) => u.includes(encodeURIComponent(KEY))));
  assertFalse(JSON.stringify(body).includes(KEY));

  // the upstream error message holds the url (and so the key): it must not reach the log
  const logged: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => logged.push(a.join(" "));
  try {
    state.failing = true;
    state.now += FRESH_MS + 1;
    await get("operator=keio&trips=T1");
  } finally {
    console.error = original;
  }
  assert(logged.length > 0);
  assertFalse(logged.join("\n").includes(KEY));
});

Deno.test("a keyed operator with no key configured is unavailable (503), without a fetch", async () => {
  const { get, state } = harness();
  const { status, body } = await get("operator=jreast&trips=T1");
  assertEquals([status, body.reason], [503, "not_configured"]);
  assertEquals(state.fetches.length, 0);
});

Deno.test("operators without an alert feed say 'none', and CORS preflight works", async () => {
  const { get, service } = harness({ env: { ODPT_CHALLENGE_KEY: "k" } });
  assertEquals((await get("operator=jreast&trips=T1")).body.alertsStatus, "none");
  const pre = await service.handle(
    new Request("https://x.test/live-status", { method: "OPTIONS" }),
  );
  assertEquals(pre.status, 204);
  assertEquals(
    (await service.handle(new Request("https://x.test/live-status", { method: "POST" }))).status,
    405,
  );
});
