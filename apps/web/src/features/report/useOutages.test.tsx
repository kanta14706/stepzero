import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeOutageSource, outage } from './fakeSource';
import { OutageSourceProvider, useOutages, useOutagesFor } from './useOutages';

function setup(stationId = 'T') {
  const source = new FakeOutageSource();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <OutageSourceProvider source={source}>{children}</OutageSourceProvider>
  );
  const hook = renderHook(({ id }) => useOutages(id), { wrapper, initialProps: { id: stationId } });
  return { source, hook };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useOutages', () => {
  it('starts connecting, then lists the blocked edges from the loaded reports', () => {
    const { source, hook } = setup();
    expect(hook.result.current.status).toBe('connecting');
    expect(hook.result.current.loaded).toBe(false);
    act(() => {
      source.push(
        'T',
        [outage({ id: 'a', edgeId: 'e2' }), outage({ id: 'b', edgeId: 'e1' })],
        true,
      );
    });
    expect(hook.result.current.status).toBe('live');
    expect(hook.result.current.loaded).toBe(true);
    expect(hook.result.current.blockedEdgeIds).toEqual(['e1', 'e2']);
  });

  it('clears an edge when a "working" report arrives and the old one is ended', () => {
    const { source, hook } = setup();
    const broken = outage({ id: 'a' });
    act(() => {
      source.push('T', [broken], true);
    });
    act(() => {
      source.push('T', [
        { ...broken, expiresAt: broken.createdAt },
        outage({ id: 'b', status: 'working' }),
      ]);
    });
    expect(hook.result.current.blockedEdgeIds).toEqual([]);
    expect(hook.result.current.reports.map((r) => r.id)).toEqual(['b']);
  });

  it('drops a report when it expires', () => {
    vi.useFakeTimers({ now: new Date('2026-10-06T10:00:00Z') });
    const { source, hook } = setup();
    act(() => {
      source.push('T', [outage({ expiresAt: '2026-10-06T10:05:00Z' })], true);
    });
    expect(hook.result.current.blockedEdgeIds).toEqual(['e1']);
    act(() => {
      vi.advanceTimersByTime(5 * 60_000 + 100);
    });
    expect(hook.result.current.blockedEdgeIds).toEqual([]);
  });

  it('applies the answer to a report at once', async () => {
    const { source, hook } = setup();
    source.answer = () => Promise.resolve([outage({ id: 'x', edgeId: 'e9' })]);
    await act(async () => {
      await hook.result.current.report('e9', 'out_of_service');
    });
    expect(source.sent).toEqual([{ edgeId: 'e9', status: 'out_of_service' }]);
    expect(hook.result.current.blockedEdgeIds).toEqual(['e9']);
  });

  it('forgets the previous station when the station changes', () => {
    const { source, hook } = setup('A');
    act(() => {
      source.push('A', [outage({ stationId: 'A' })], true);
    });
    hook.rerender({ id: 'B' });
    expect(hook.result.current.blockedEdgeIds).toEqual([]);
    expect(source.watchers.has('A')).toBe(false);
    expect(source.watchers.has('B')).toBe(true);
  });

  it('says "unavailable" when no back end is configured', () => {
    const { result } = renderHook(() => useOutages('T'));
    expect(result.current.status).toBe('unavailable');
  });
});

describe('useOutagesFor', () => {
  it('follows several stations, applies an answer to its own station, and reports the weakest status', async () => {
    const source = new FakeOutageSource();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <OutageSourceProvider source={source}>{children}</OutageSourceProvider>
    );
    const hook = renderHook(() => useOutagesFor(['A', 'B']), { wrapper });
    expect(hook.result.current.status).toBe('connecting');
    act(() => {
      source.push('A', [outage({ stationId: 'A', edgeId: 'a1' })], true);
    });
    expect(hook.result.current.status).toBe('connecting'); // B is not live yet
    expect(hook.result.current.loaded).toBe(false);
    act(() => {
      source.push('B', [], true);
    });
    expect(hook.result.current.status).toBe('live');
    expect(hook.result.current.loaded).toBe(true);
    source.answer = () => Promise.resolve([outage({ id: 'x', stationId: 'B', edgeId: 'b1' })]);
    await act(async () => {
      await hook.result.current.report('b1', 'out_of_service');
    });
    expect(hook.result.current.byStation.get('A')?.blockedEdgeIds).toEqual(['a1']);
    expect(hook.result.current.byStation.get('B')?.blockedEdgeIds).toEqual(['b1']);
  });
});
