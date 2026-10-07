/**
 * Train itineraries from OpenTripPlanner 2 (GTFS GraphQL API). OTP plans the trains; the app's
 * own router plans the inside of each station with full detail (CLAUDE.md, hybrid routing).
 *
 * The endpoint is `VITE_OTP_URL`, or `/otp/gtfs/v1` on the app's own origin, which the Vite dev
 * and preview servers proxy to a local OTP (vite.config.ts). OTP needs no key.
 */
import type { ProfileId } from '../../routing/types';
import PLAN_QUERY from './plan.graphql?raw';
import WALK_QUERY from './walk.graphql?raw';
import type { Itinerary, LatLon, LiveRef, OtpLeg, OtpStop, Place } from './types';

export { PLAN_QUERY, WALK_QUERY };

export function otpUrl(
  env: Record<string, string | boolean | undefined> = import.meta.env,
): string {
  const url = env['VITE_OTP_URL'];
  if (typeof url === 'string' && url) return url;
  const base = typeof env['BASE_URL'] === 'string' ? env['BASE_URL'] : '/';
  return `${base.replace(/\/$/, '')}/otp/gtfs/v1`;
}

/** The step-free profiles ask OTP to prefer accessible stops and transfers where it has data. */
export function otpWheelchair(profile: ProfileId): boolean {
  return profile === 'wheelchair' || profile === 'walker_cane' || profile === 'stroller_luggage';
}

export type PlanErrorCode =
  /** OTP is not reachable (offline, not deployed, server down). */
  | 'unavailable'
  /** OTP answered, but found no trains between the two places. */
  | 'no_trains'
  /** The date is outside the timetable OTP has. */
  | 'outside_service_period'
  /** OTP does not know one of the places. */
  | 'location_not_found';

export class PlanError extends Error {
  constructor(readonly code: PlanErrorCode) {
    super(code);
  }
}

interface OtpOptions {
  url?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

type OtpLocation =
  | { location: { stopLocation: { stopLocationId: string } } }
  | { location: { coordinate: { latitude: number; longitude: number } } };

export function otpLocation(place: Place | LatLon): OtpLocation {
  if ('kind' in place && place.kind === 'station') {
    return { location: { stopLocation: { stopLocationId: place.station.otpId } } };
  }
  return { location: { coordinate: { latitude: place.lat, longitude: place.lon } } };
}

async function post<T>(query: string, variables: object, opts: OtpOptions): Promise<T> {
  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(opts.url ?? otpUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      ...(opts.signal && { signal: opts.signal }),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new PlanError('unavailable');
  }
  if (!res.ok) throw new PlanError('unavailable');
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: unknown } | null;
  if (!body?.data) throw new PlanError('unavailable');
  return body.data;
}

// --- Response shapes (only the fields the queries ask for) ---

interface RawPlace {
  name: string;
  lat: number;
  lon: number;
  /** `{}` when the place is not a stop of a trip (a walk's ends, the union's other member). */
  stopPosition?: { position?: number } | null;
  stop: {
    gtfsId: string;
    platformCode: string | null;
    parentStation: { gtfsId: string } | null;
  } | null;
}

interface RawLeg {
  mode: string;
  duration: number;
  distance: number;
  headsign: string | null;
  serviceDate?: string | null;
  trip?: { gtfsId: string } | null;
  start: { scheduledTime: string };
  end: { scheduledTime: string };
  from: RawPlace;
  to: RawPlace;
  route: {
    gtfsId: string;
    shortName: string | null;
    longName: string | null;
    color: string | null;
  } | null;
  intermediateStops: { gtfsId: string }[] | null;
}

interface RawPlan {
  planConnection: {
    routingErrors: { code: string }[];
    edges: { node: { start: string; end: string; legs: RawLeg[] } }[];
  };
}

/** "1:421P4" -> "421P4": ids in the app have no OTP feed prefix. */
export function stripFeed(gtfsId: string): string {
  const i = gtfsId.indexOf(':');
  return i < 0 ? gtfsId : gtfsId.slice(i + 1);
}

function toStop(p: RawPlace): OtpStop {
  const stopId = p.stop ? stripFeed(p.stop.gtfsId) : null;
  return {
    name: p.name,
    lat: p.lat,
    lon: p.lon,
    stopId,
    stationId: p.stop?.parentStation ? stripFeed(p.stop.parentStation.gtfsId) : stopId,
    platformCode: p.stop?.platformCode ?? null,
  };
}

/** The live-feed key of a ride, or null when OTP did not give every part of it. */
function toLiveRef(l: RawLeg): LiveRef | null {
  const trip = l.trip?.gtfsId;
  const fromSeq = l.from.stopPosition?.position;
  const toSeq = l.to.stopPosition?.position;
  const date = l.serviceDate?.replaceAll('-', '');
  if (!trip || !date || fromSeq === undefined || toSeq === undefined) return null;
  const i = trip.indexOf(':');
  if (i < 0) return null; // no feed prefix: cannot tell which operator's feed it belongs to
  return { feedId: trip.slice(0, i), tripId: trip.slice(i + 1), serviceDate: date, fromSeq, toSeq };
}

function toLeg(l: RawLeg): OtpLeg {
  const from = toStop(l.from);
  const to = toStop(l.to);
  const departure = l.start.scheduledTime;
  const arrival = l.end.scheduledTime;
  if (l.mode === 'WALK' || !l.route) {
    return {
      kind: 'walk',
      from,
      to,
      departure,
      arrival,
      distanceM: l.distance,
      seconds: l.duration,
    };
  }
  return {
    kind: 'ride',
    mode: l.mode,
    route: {
      id: l.route.gtfsId,
      name: l.route.longName ?? l.route.shortName ?? '',
      color: l.route.color ? `#${l.route.color}` : null,
    },
    headsign: l.headsign,
    from,
    to,
    departure,
    arrival,
    stops: l.intermediateStops?.length ?? 0,
    distanceM: l.distance,
    live: toLiveRef(l),
  };
}

const ERROR_CODES: Record<string, PlanErrorCode> = {
  OUTSIDE_SERVICE_PERIOD: 'outside_service_period',
  LOCATION_NOT_FOUND: 'location_not_found',
  NO_STOPS_IN_RANGE: 'no_trains',
  NO_TRANSIT_CONNECTION: 'no_trains',
  NO_TRANSIT_CONNECTION_IN_SEARCH_WINDOW: 'no_trains',
  WALKING_BETTER_THAN_TRANSIT: 'no_trains',
};

/** Parses a Plan response. Exposed so tests can feed recorded OTP answers. */
export function parsePlan(data: RawPlan): Itinerary[] {
  const pc = data.planConnection;
  const itineraries = pc.edges
    .map(({ node }) => ({ start: node.start, end: node.end, legs: node.legs.map(toLeg) }))
    .filter((it) => it.legs.some((l) => l.kind === 'ride'));
  if (itineraries.length === 0) {
    const code = pc.routingErrors.map((e) => ERROR_CODES[e.code]).find(Boolean);
    throw new PlanError(code ?? 'no_trains');
  }
  return itineraries;
}

export interface PlanTrainsInput {
  from: Place;
  to: Place;
  time: string;
  profile: ProfileId;
  first?: number;
}

export async function planTrains(
  input: PlanTrainsInput,
  opts: OtpOptions = {},
): Promise<Itinerary[]> {
  const data = await post<RawPlan>(
    PLAN_QUERY,
    {
      origin: otpLocation(input.from),
      destination: otpLocation(input.to),
      time: input.time,
      wheelchair: otpWheelchair(input.profile),
      first: input.first ?? 6,
    },
    opts,
  );
  return parsePlan(data);
}

interface RawWalk {
  planConnection: {
    routingErrors: { code: string }[];
    edges: { node: { duration: number; legs: { distance: number }[] } }[];
  };
}

/** A street walk on OTP's street network, or null when OTP cannot route it. */
export async function planWalk(
  from: LatLon,
  to: LatLon,
  time: string,
  profile: ProfileId,
  opts: OtpOptions = {},
): Promise<{ distanceM: number; seconds: number } | null> {
  const data = await post<RawWalk>(
    WALK_QUERY,
    {
      origin: otpLocation(from),
      destination: otpLocation(to),
      time,
      wheelchair: otpWheelchair(profile),
    },
    opts,
  );
  const node = data.planConnection.edges[0]?.node;
  if (!node) return null;
  return {
    distanceM: node.legs.reduce((s, l) => s + l.distance, 0),
    seconds: node.duration,
  };
}
