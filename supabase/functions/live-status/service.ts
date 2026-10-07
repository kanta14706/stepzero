// Request handling for live-status: validation, a short cache, and honest stale/unavailable states.
//   GET /live-status?operator=toei&trips=101773H0,101785H0
// Returns the live stop times of the requested trips (GTFS trip_id, no feed prefix) and the
// operator's alerts. The app compares the live times with the schedule OTP gave it: the feeds
// carry absolute times, not delays. Nothing here is per user, so responses carry no personal data.
import {
  type AlertSnapshot,
  decodeAlerts,
  decodeTripUpdates,
  type LiveTrip,
  type TripSnapshot,
} from "./feed.ts";
import { feedUrl, OPERATORS } from "./operators.ts";

export const FRESH_MS = 15_000; // one upstream fetch per operator per feed in this window
export const STALE_AFTER_S = 120; // the feed's own timestamp is older than this: say so
export const MAX_TRIPS = 60;
const FETCH_TIMEOUT_MS = 8_000;
const TRIP_ID = /^[A-Za-z0-9_.-]{1,64}$/;

export interface Deps {
  fetchBytes(url: string): Promise<Uint8Array>; // must not put the url in its errors (it holds the key)
  now(): number; // epoch ms
  env(name: string): string | undefined;
}

export const realDeps: Deps = {
  async fetchBytes(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  },
  now: () => Date.now(),
  env: (name) => Deno.env.get(name),
};

interface Loaded<T> {
  value: T;
  fetchedAt: number;
  refreshFailed: boolean; // the newest fetch failed; this is the last good copy
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function createService(deps: Deps) {
  const cache = new Map<string, { value: unknown; fetchedAt: number }>();
  const inflight = new Map<string, Promise<void>>();

  async function load<T>(
    key: string,
    url: string,
    decode: (b: Uint8Array) => T,
  ): Promise<Loaded<T> | null> {
    const fresh = () => {
      const c = cache.get(key);
      return c && deps.now() - c.fetchedAt < FRESH_MS ? c : null;
    };
    if (!fresh()) {
      let p = inflight.get(key); // concurrent requests share one upstream fetch
      if (!p) {
        p = (async () => {
          try {
            const value = decode(await deps.fetchBytes(url));
            cache.set(key, { value, fetchedAt: deps.now() });
          } catch (err) {
            // never log the message verbatim: be strict about what could carry the key
            console.error(`live-status: ${key} refresh failed (${(err as Error).name})`);
          }
        })().finally(() => inflight.delete(key));
        inflight.set(key, p);
      }
      await p;
    }
    const c = cache.get(key);
    if (!c) return null;
    return { value: c.value as T, fetchedAt: c.fetchedAt, refreshFailed: !fresh() };
  }

  async function handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

    const q = new URL(req.url).searchParams;
    const operatorId = q.get("operator") ?? "";
    const op = Object.hasOwn(OPERATORS, operatorId) ? OPERATORS[operatorId] : undefined;
    if (!op) return json({ error: "unknown_operator", operators: Object.keys(OPERATORS) }, 400);
    const tripIds = [...new Set((q.get("trips") ?? "").split(",").filter(Boolean))];
    if (tripIds.length > MAX_TRIPS) return json({ error: "too_many_trips", max: MAX_TRIPS }, 400);
    if (!tripIds.every((t) => TRIP_ID.test(t))) return json({ error: "bad_trip_id" }, 400);

    let tripUrl: string;
    let alertUrl: string | null;
    try {
      tripUrl = feedUrl(op.tripUpdatesUrl, op, deps.env);
      alertUrl = op.alertsUrl ? feedUrl(op.alertsUrl, op, deps.env) : null;
    } catch {
      return json({ operator: operatorId, status: "unavailable", reason: "not_configured" }, 503);
    }

    const [trips, alerts] = await Promise.all([
      load<TripSnapshot>(`${operatorId}:trips`, tripUrl, decodeTripUpdates),
      alertUrl ? load<AlertSnapshot>(`${operatorId}:alerts`, alertUrl, decodeAlerts) : null,
    ]);
    if (!trips) {
      return json({ operator: operatorId, feedId: op.feedId, status: "unavailable" }, 502);
    }

    const now = deps.now();
    const stamp = trips.value.feedTimestamp ?? Math.floor(trips.fetchedAt / 1000);
    const age = Math.max(0, Math.floor(now / 1000) - stamp);
    const found: Record<string, LiveTrip> = {};
    for (const id of tripIds) {
      const t = trips.value.trips.get(id);
      if (t) found[id] = t;
    }
    return json({
      operator: operatorId,
      feedId: op.feedId,
      // ok: fresh data. stale: the feed stopped updating, or we could not refresh it and this
      // is the last good copy. The app must say so instead of showing "on time".
      status: age > STALE_AFTER_S || trips.refreshFailed ? "stale" : "ok",
      feedTimestamp: new Date(stamp * 1000).toISOString(),
      ageSeconds: age,
      trips: found, // requested trips with no live data are simply absent
      tripCount: trips.value.trips.size,
      alertsStatus: alerts === null
        ? (op.alertsUrl ? "unavailable" : "none")
        : alerts.refreshFailed
        ? "stale"
        : "ok",
      alerts: alerts?.value.alerts.slice(0, 100) ?? [],
    });
  }

  return { handle };
}
