/**
 * Boarding position (step 2.6): is a point on the platform near the front, the middle or the back
 * of the train? The data has no car or door positions, so a car number cannot be given; the
 * platform is split into thirds between its outermost boarding areas, and the front is the end
 * trains run towards (importer/graph/travel.py). Method and limits: docs/data-notes.md.
 */
import type { GraphIndex } from './astar';
import type { Names, NodeId, PlatformTravel } from './types';

export type TrainPart = 'front' | 'middle' | 'back';

export interface BoardingPosition {
  part: TrainPart;
  /** 0 at the front end of the platform, 1 at the back end. */
  fromFront: number;
  /** 'weak' when the direction comes from stations well off the platform axis. */
  confidence: PlatformTravel['confidence'];
  /** Few boarding areas, so the platform ends (and the thirds) are uncertain. */
  approximate: boolean;
  nextStop: Names | null;
  prevStop: Names | null;
  /** 'all' when every train ends here: nobody boards on this platform. */
  terminating: 'all' | 'some' | null;
}

const lonScale = (lat: number) => Math.cos((lat * Math.PI) / 180);

export function partOf(fromFront: number): TrainPart {
  return fromFront < 1 / 3 ? 'front' : fromFront < 2 / 3 ? 'middle' : 'back';
}

/** Where `nodeId` lies along platform `platformId`, or null when the data cannot say. */
export function boardingPosition(
  index: GraphIndex,
  platformId: string | null,
  nodeId: NodeId,
): BoardingPosition | null {
  const platform = index.graph.station.platforms.find((p) => p.id === platformId);
  const travel = platform?.travel;
  const front = travel && index.nodes.get(travel.frontNodeId);
  const back = travel && index.nodes.get(travel.backNodeId);
  const at = index.nodes.get(nodeId);
  if (!travel || !front || !back || !at) return null;
  const k = lonScale(front.lat);
  const ax = (back.lon - front.lon) * k;
  const ay = back.lat - front.lat;
  const len2 = ax * ax + ay * ay;
  if (len2 === 0) return null;
  const t = ((at.lon - front.lon) * k * ax + (at.lat - front.lat) * ay) / len2;
  const fromFront = Math.min(1, Math.max(0, t));
  return {
    part: partOf(fromFront),
    fromFront,
    confidence: travel.confidence,
    approximate: travel.approximate === true,
    nextStop: travel.nextStop ?? null,
    prevStop: travel.prevStop ?? null,
    terminating: travel.terminating ?? null,
  };
}
