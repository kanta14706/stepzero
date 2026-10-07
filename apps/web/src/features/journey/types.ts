/** Types for the journey planner (step 2.4): places, train itineraries from OTP, journeys. */
import type { GraphIndex } from '../../routing/astar';
import type { BoardingPosition } from '../../routing/boarding';
import type { Names, NoRoute, AlternativeCode, ProfileId, RouteResult } from '../../routing/types';

/** One entry of data/stations.json (docs/stations.schema.json). */
export interface Station {
  id: string;
  otpId: string;
  code?: string;
  name: Names;
  lat: number;
  lon: number;
  lines: { id: string; name: Names; color?: string }[];
  tier: 1 | 2;
}

export interface StationList {
  schemaVersion: 1;
  feed: string;
  stations: Station[];
}

/** Where a journey starts or ends: a station, or a point found by address or place search. */
export type Place =
  | { kind: 'station'; station: Station }
  | { kind: 'point'; lat: number; lon: number; label: string; source: 'address' | 'place' };

export interface LatLon {
  lat: number;
  lon: number;
}

/** A stop as OTP reports it, with the feed prefix removed from the ids. */
export interface OtpStop {
  name: string;
  lat: number;
  lon: number;
  /** GTFS stop id of the boarding stop, e.g. "421P4" or "412"; null for the origin or destination. */
  stopId: string | null;
  /** The station: the parent station when there is one, otherwise the stop itself. */
  stationId: string | null;
  platformCode: string | null;
}

/**
 * What identifies one train in the live feeds (D-027): the operator's OTP feed id, the GTFS trip,
 * its service day (OTP's own, so a 00:02 train belongs to the day before) and the positions of the
 * boarding and alighting stops, which are the feeds' `stop_sequence`.
 */
export interface LiveRef {
  feedId: string;
  tripId: string;
  /** YYYYMMDD. */
  serviceDate: string;
  fromSeq: number;
  toSeq: number;
}

export interface RideLeg {
  kind: 'ride';
  mode: string;
  route: { id: string; name: string; color: string | null };
  headsign: string | null;
  from: OtpStop;
  to: OtpStop;
  /** Timetable times (ISO with offset). */
  departure: string;
  arrival: string;
  /** Stops between boarding and alighting. */
  stops: number;
  distanceM: number;
  /** Null when OTP did not say (plans saved before step 2.7 have no such field at all). */
  live?: LiveRef | null;
}

export interface WalkLeg {
  kind: 'walk';
  from: OtpStop;
  to: OtpStop;
  departure: string;
  arrival: string;
  distanceM: number;
  seconds: number;
}

export type OtpLeg = RideLeg | WalkLeg;

export interface Itinerary {
  start: string;
  end: string;
  legs: OtpLeg[];
}

/** Street walk between an address and a station entrance. */
export interface StreetWalk {
  distanceM: number;
  seconds: number;
  /** 'otp': routed on the street network; 'straight_line': OTP could not route it. */
  source: 'otp' | 'straight_line';
}

/** Where to ride, so as to get off near the step-free way out (or to the next platform). */
export interface RideAdvice {
  position: BoardingPosition;
  /** The station where the advice pays off. */
  stationId: string;
  purpose: 'exit' | 'transfer';
}

export type RouteOk = Extract<RouteResult, { ok: true }>;

/** Inside one station: from the street to a platform, between platforms, or back out. */
export type StationSegment =
  | {
      kind: 'station';
      role: 'access' | 'transfer' | 'egress';
      stationId: string;
      /** Full detail: the in-station route. */
      tier: 2;
      route: RouteOk;
      /** The station graph the route is on (for the step list and the station page). */
      index: GraphIndex;
      /** Where the route meets the platform the train is boarded from (access and transfer). */
      boardAt: BoardingPosition | null;
    }
  | {
      kind: 'station';
      role: 'access' | 'transfer' | 'egress';
      stationId: string;
      /** No in-station data: the station is named, nothing is promised. */
      tier: 1;
      /** For transfers, OTP's walk between the two stops when it gave one. */
      walk: WalkLeg | null;
    };

export type Segment =
  | ({
      kind: 'street';
      role: 'access' | 'egress';
      place: Extract<Place, { kind: 'point' }>;
    } & StreetWalk)
  | StationSegment
  | { kind: 'ride'; leg: RideLeg; advice: RideAdvice | null }
  /** A walk between two different stations at a transfer (OTP), not checked for steps. */
  | { kind: 'walk'; leg: WalkLeg };

export interface Journey {
  segments: Segment[];
  /** When to leave the origin (estimated; null when the first station has no in-station data). */
  leaveAt: string | null;
  /** When the train is boarded and when the destination is reached (estimated). */
  firstDeparture: string;
  arriveAt: string;
  rides: number;
  elevatorRides: number;
  /** Stations on the journey without in-station detail (tier 1). */
  unverifiedStations: string[];
  /** Transfers where our in-station route takes longer than the timetable allows. */
  tightTransfers: string[];
  itinerary: Itinerary;
}

/** Why one train itinerary could not be used. */
export interface Rejection {
  stationId: string;
  role: 'access' | 'transfer' | 'egress';
  failure: NoRoute;
  alternatives: AlternativeCode[];
}

export interface JourneyRequest {
  from: Place;
  to: Place;
  profile: ProfileId;
  /** ISO time to leave at. */
  time: string;
}
