import { describe, expect, it } from 'vitest';
import { edge } from './fixtures';
import { buildOutageIndex, isBlocked } from './outages';
import type { OutageReport } from './types';

const NOW = new Date('2026-10-05T12:00:00Z');

function report(over: Partial<OutageReport>): OutageReport {
  return {
    id: 'r',
    pathwayId: null,
    edgeId: 'e1',
    stationId: 'T',
    status: 'out_of_service',
    createdAt: '2026-10-05T11:00:00Z',
    expiresAt: '2026-10-05T17:00:00Z',
    confirmations: 1,
    source: 'community',
    ...over,
  };
}

describe('outage index', () => {
  it('blocks edges with an active out_of_service or blocked report', () => {
    const idx = buildOutageIndex(
      [report({ edgeId: 'a' }), report({ edgeId: 'b', status: 'blocked' })],
      NOW,
    );
    expect(idx.blockedEdgeIds).toEqual(new Set(['a', 'b']));
  });
  it('ignores expired reports', () => {
    const idx = buildOutageIndex([report({ expiresAt: '2026-10-05T11:59:59Z' })], NOW);
    expect(idx.blockedEdgeIds.size).toBe(0);
  });
  it('lets the newest report win: a later "working" clears the edge', () => {
    const idx = buildOutageIndex(
      [
        report({ id: '1' }),
        report({ id: '2', status: 'working', createdAt: '2026-10-05T11:30:00Z' }),
      ],
      NOW,
    );
    expect(idx.blockedEdgeIds.size).toBe(0);
  });
  it('lets a newer out_of_service override an older "working"', () => {
    const idx = buildOutageIndex(
      [
        report({ id: '1', status: 'working' }),
        report({ id: '2', createdAt: '2026-10-05T11:30:00Z' }),
      ],
      NOW,
    );
    expect(idx.blockedEdgeIds).toEqual(new Set(['e1']));
  });
  it('does not treat data_wrong as an outage', () => {
    expect(buildOutageIndex([report({ status: 'data_wrong' })], NOW).blockedEdgeIds.size).toBe(0);
  });
  it('matches by edge id or by pathway id', () => {
    const idx = buildOutageIndex([report({ edgeId: 'x', pathwayId: 'P1' })], NOW);
    expect(isBlocked(idx, edge('x', 'a', 'b', 'walk'))).toBe(true);
    expect(isBlocked(idx, edge('y', 'a', 'b', 'walk', { pathwayId: 'P1' }))).toBe(true);
    expect(isBlocked(idx, edge('z', 'a', 'b', 'walk', { pathwayId: 'P2' }))).toBe(false);
  });
});
