/** Types for the station graph JSON (docs/graph.schema.json) and for routing results. */

export type NodeId = string;

export type NodeKind = 'entrance' | 'gate' | 'platform' | 'elevator' | 'junction' | 'street';

export type EdgeMode =
  'walk' | 'stairs' | 'escalator' | 'elevator' | 'ramp' | 'moving_walkway' | 'fare_gate';

export interface GraphNode {
  id: NodeId;
  lon: number;
  lat: number;
  level: number;
  kind: NodeKind;
  stationId: string;
  name?: Partial<Record<string, string>>;
  gtfsStopId?: string;
  platformId?: string;
  gtfsLevel?: number;
}

/** Absent optional attributes mean "unknown", never zero. */
export interface GraphEdge {
  id: string;
  from: NodeId;
  to: NodeId;
  mode: EdgeMode;
  lengthM: number;
  seconds: number;
  /** Upper bound of the ほこナビ slope bucket (0, 5, 8, 18). */
  slopePct?: number;
  /** Lower bound of the width bucket (0 means under 1.0 m). */
  widthM?: number;
  /** Upper bound of the step bucket (0, 2, 5, 10). */
  stepHeightCm?: number;
  roofed?: boolean;
  tactilePaving?: boolean;
  pathwayId?: string;
  bidirectional: boolean;
}

export type Names = Partial<Record<string, string>>;

/** Which way trains run along a platform (docs/graph.schema.json `travel`, step 2.6). */
export interface PlatformTravel {
  frontNodeId: NodeId;
  backNodeId: NodeId;
  lengthM: number;
  areas: number;
  confidence: 'clear' | 'weak';
  approximate?: true;
  nextStop?: Names;
  prevStop?: Names;
  headsigns?: Names[];
  terminating?: 'all' | 'some';
}

export interface Platform {
  id: string;
  code?: string;
  nodeIds: NodeId[];
  /** Absent when the data cannot tell which way trains run. */
  travel?: PlatformTravel;
}

export interface StationGraph {
  schemaVersion: 1;
  station: {
    id: string;
    slug: string;
    name: Partial<Record<string, string>>;
    levels: number[];
    /** [minLon, minLat, maxLon, maxLat] */
    bbox: [number, number, number, number];
    platforms: Platform[];
    warnings: { code: string; message: string }[];
  };
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type ProfileId =
  'wheelchair' | 'walker_cane' | 'stroller_luggage' | 'low_stamina' | 'sensory';

export type OutageStatus = 'out_of_service' | 'working' | 'blocked' | 'data_wrong';

export interface OutageReport {
  id: string;
  pathwayId: string | null;
  edgeId: string;
  stationId: string;
  status: OutageStatus;
  createdAt: string;
  expiresAt: string;
  confirmations: number;
  source: 'community' | 'operator';
}

/** Why an edge cannot be used by a profile. */
export type BlockReason = 'stairs' | 'escalator' | 'slope_too_steep' | 'step_too_high' | 'outage';

export interface RouteLeg {
  edge: GraphEdge;
  /** True when the edge is walked from `edge.from` to `edge.to`. */
  forward: boolean;
  from: NodeId;
  to: NodeId;
  seconds: number;
  /** Cost as the profile sees it (seconds times penalties). */
  cost: number;
}

export interface RouteSummary {
  seconds: number;
  lengthM: number;
  elevators: number;
  levelChanges: number;
}

/** Suggestions for when no route exists. The UI turns codes into text. */
export type AlternativeCode =
  | 'try_another_entrance'
  | 'try_another_station'
  | 'ask_staff'
  | 'use_accessible_bus'
  | 'wait_for_repair'
  | 'try_another_profile';

export type NoRoute =
  | { reason: 'unknown_node'; nodeIds: NodeId[] }
  /** The graph has no path at all between the two ends, whatever the profile. */
  | { reason: 'disconnected' }
  /** A path exists, but every one uses an edge this profile cannot take. */
  | { reason: 'blocked_by_profile'; blockers: Record<BlockReason, number> }
  /** A path exists for this profile, but only through edges with an active outage. */
  | { reason: 'blocked_by_outage'; outageEdgeIds: string[] };

export type RouteResult =
  | {
      ok: true;
      legs: RouteLeg[];
      nodes: NodeId[];
      summary: RouteSummary;
      /** Edges on the route whose slope or step height is unknown in the data. */
      uncertainEdgeIds: string[];
    }
  | { ok: false; failure: NoRoute; alternatives: AlternativeCode[] };
