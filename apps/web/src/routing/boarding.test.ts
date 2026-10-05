import { describe, expect, it } from 'vitest';
import { indexGraph } from './astar';
import { boardingPosition, partOf } from './boarding';
import { graph, node } from './fixtures';
import type { GraphNode, PlatformTravel, StationGraph } from './types';

const M_PER_DEG_LON = 111320 * Math.cos((35 * Math.PI) / 180);
/** A boarding area `x` metres east of a fixed point on platform P. */
const area = (id: string, x: number): GraphNode => ({
  ...node(id, 'platform', -2, 139 + x / M_PER_DEG_LON, 35),
  platformId: 'P',
});

/** A 120 m platform along the east-west axis; trains run west to east, so the front is east. */
function platformGraph(travel: Partial<PlatformTravel> | null = {}): StationGraph {
  const g = graph(
    [area('w', -60), area('m', 0), area('e', 60), area('near-e', 50), area('near-w', -50)],
    [],
  );
  return {
    ...g,
    station: {
      ...g.station,
      platforms: [
        {
          id: 'P',
          code: '1',
          nodeIds: ['w', 'm', 'e', 'near-e', 'near-w'],
          ...(travel === null
            ? {}
            : {
                travel: {
                  frontNodeId: 'e',
                  backNodeId: 'w',
                  lengthM: 120,
                  areas: 5,
                  confidence: 'clear',
                  nextStop: { ja: '東', en: 'East' },
                  ...travel,
                },
              }),
        },
      ],
    },
  };
}

describe('partOf', () => {
  it.each([
    [0, 'front'],
    [0.33, 'front'],
    [0.34, 'middle'],
    [0.66, 'middle'],
    [0.67, 'back'],
    [1, 'back'],
  ] as const)('%d from the front is the %s', (f, part) => {
    expect(partOf(f)).toBe(part);
  });
});

describe('boardingPosition', () => {
  const index = indexGraph(platformGraph());

  it('measures from the front end, the end trains run towards', () => {
    const nearFront = boardingPosition(index, 'P', 'near-e');
    expect(nearFront?.part).toBe('front');
    expect(nearFront?.fromFront).toBeCloseTo(10 / 120, 2);
    expect(boardingPosition(index, 'P', 'm')?.part).toBe('middle');
    expect(boardingPosition(index, 'P', 'near-w')?.part).toBe('back');
    expect(boardingPosition(index, 'P', 'w')?.fromFront).toBeCloseTo(1, 5);
  });

  it('carries the direction and how far to trust it', () => {
    const weak = indexGraph(platformGraph({ confidence: 'weak', approximate: true }));
    expect(boardingPosition(weak, 'P', 'm')).toMatchObject({
      confidence: 'weak',
      approximate: true,
      nextStop: { ja: '東', en: 'East' },
      prevStop: null,
      terminating: null,
    });
  });

  it('says nothing when the data cannot tell the direction or the place is unknown', () => {
    expect(boardingPosition(indexGraph(platformGraph(null)), 'P', 'm')).toBeNull();
    expect(boardingPosition(index, 'other', 'm')).toBeNull();
    expect(boardingPosition(index, null, 'm')).toBeNull();
    expect(boardingPosition(index, 'P', 'nowhere')).toBeNull();
  });
});
