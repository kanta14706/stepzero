import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LiveFetchError } from './api';
import { legKey } from './delay';
import { ARR, DEP, alert, epoch, lateTrip, response, ride, trip, stopTime } from './testing';
import { useLiveStatus } from './useLiveStatus';
import type { LiveFetch } from './useLiveStatus';

const toei = ride();
const jr = ride({
  route: { id: '6:JY', name: '山手線', color: null },
  live: { feedId: '6', tripId: 'J9', serviceDate: '20261007', fromSeq: 1, toSeq: 4 },
});
const metro = ride({
  route: { id: '2:H', name: '日比谷線', color: null },
  live: { feedId: '2', tripId: 'M1', serviceDate: '20261007', fromSeq: 1, toSeq: 4 },
});

const ok = (resp = response({ T1: lateTrip(300) })): LiveFetch =>
  vi.fn(() => Promise.resolve(resp));
const base = { intervalMs: 20, isOnline: () => true, config: null };

describe('useLiveStatus', () => {
  it('is loading, then has the delay of the train', async () => {
    const fetchLive = ok();
    const { result } = renderHook(() => useLiveStatus([toei], { ...base, fetchLive }));
    expect(result.current.byLeg.get(legKey(toei))?.feed).toBe('loading');
    await waitFor(() => {
      expect(result.current.byLeg.get(legKey(toei))?.arrDelayS).toBe(300);
    });
    expect(result.current.updatedAt).not.toBeNull();
    expect(result.current.covered).toBe(true);
    expect(fetchLive).toHaveBeenCalledWith('toei', ['T1'], expect.any(AbortSignal));
  });

  it('asks once per operator, and says plainly when an operator has no feed', async () => {
    const fetchLive: LiveFetch = vi.fn((op) =>
      Promise.resolve(
        op === 'toei' ? response({ T1: lateTrip(0) }) : response({}, { operator: 'jreast' }),
      ),
    );
    const { result } = renderHook(() =>
      useLiveStatus([toei, jr, metro], { ...base, fetchLive, intervalMs: 5000 }),
    );
    await waitFor(() => {
      expect(result.current.byLeg.get(legKey(jr))?.trip).toBe('no_data');
    });
    expect(
      vi
        .mocked(fetchLive)
        .mock.calls.map(([op]) => op)
        .sort(),
    ).toEqual(['jreast', 'toei']);
    expect(result.current.byLeg.get(legKey(metro))?.feed).toBe('not_covered'); // no GTFS-RT for Metro
    expect(result.current.byLeg.get(legKey(toei))?.trip).toBe('live');
  });

  it('keeps polling, but does not start over when the same trains arrive in a new array', async () => {
    const fetchLive = ok();
    const { rerender } = renderHook(
      ({ legs }) => useLiveStatus(legs, { ...base, fetchLive, intervalMs: 40 }),
      {
        initialProps: { legs: [toei] },
      },
    );
    await waitFor(() => {
      expect(fetchLive).toHaveBeenCalledTimes(1);
    });
    rerender({ legs: [{ ...toei }] }); // same train, new object
    rerender({ legs: [{ ...toei }] });
    expect(fetchLive).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(vi.mocked(fetchLive).mock.calls.length).toBeGreaterThanOrEqual(3);
    });
  });

  it('asks again for a different train', async () => {
    const fetchLive = ok();
    const other = ride({
      live: { feedId: '1', tripId: 'T2', serviceDate: '20261007', fromSeq: 3, toSeq: 9 },
    });
    const { rerender } = renderHook(
      ({ legs }) => useLiveStatus(legs, { ...base, fetchLive, intervalMs: 5000 }),
      {
        initialProps: { legs: [toei] },
      },
    );
    await waitFor(() => {
      expect(fetchLive).toHaveBeenCalledWith('toei', ['T1'], expect.any(AbortSignal));
    });
    rerender({ legs: [other] });
    await waitFor(() => {
      expect(fetchLive).toHaveBeenCalledWith('toei', ['T2'], expect.any(AbortSignal));
    });
  });

  it('says offline without asking', () => {
    const fetchLive = ok();
    const { result } = renderHook(() =>
      useLiveStatus([toei], { ...base, fetchLive, isOnline: () => false }),
    );
    expect(result.current.byLeg.get(legKey(toei))?.feed).toBe('offline');
    expect(fetchLive).not.toHaveBeenCalled();
  });

  it('says not configured when there is no back end', () => {
    const { result } = renderHook(() => useLiveStatus([toei], base));
    expect(result.current.byLeg.get(legKey(toei))?.feed).toBe('not_configured');
  });

  it('says why when the function fails, and keeps the timetable', async () => {
    const failing: LiveFetch = vi.fn(() => Promise.reject(new LiveFetchError('unavailable')));
    const { result } = renderHook(() => useLiveStatus([toei], { ...base, fetchLive: failing }));
    await waitFor(() => {
      expect(result.current.byLeg.get(legKey(toei))?.feed).toBe('unavailable');
    });
    expect(result.current.byLeg.get(legKey(toei))?.trip).toBeNull();
    const unconfigured: LiveFetch = vi.fn(() =>
      Promise.reject(new LiveFetchError('not_configured')),
    );
    const second = renderHook(() => useLiveStatus([toei], { ...base, fetchLive: unconfigured }));
    await waitFor(() => {
      expect(second.result.current.byLeg.get(legKey(toei))?.feed).toBe('not_configured');
    });
  });

  it('reports a stale feed as stale, without delays', async () => {
    const fetchLive = ok(response({ T1: lateTrip(0) }, { status: 'stale', ageSeconds: 400 }));
    const { result } = renderHook(() => useLiveStatus([toei], { ...base, fetchLive }));
    await waitFor(() => {
      expect(result.current.byLeg.get(legKey(toei))?.feed).toBe('stale');
    });
    expect(result.current.byLeg.get(legKey(toei))?.arrDelayS).toBeNull();
  });

  it('gives each train the alerts that concern it and are active now', async () => {
    const now = epoch(DEP);
    const fetchLive = ok(
      response(
        { T1: trip([stopTime(3, { departure: now }), stopTime(9, { arrival: epoch(ARR) })]) },
        {
          alerts: [
            alert({ id: 'mine', routeIds: ['4'] }),
            alert({ id: 'other', routeIds: ['9'] }),
            alert({ id: 'over', routeIds: ['4'], periods: [{ start: null, end: now - 60 }] }),
          ],
        },
      ),
    );
    const { result } = renderHook(() =>
      useLiveStatus([toei], { ...base, fetchLive, now: () => now * 1000 }),
    );
    await waitFor(() => {
      expect(result.current.alerts.get(legKey(toei))?.map((a) => a.id)).toEqual(['mine']);
    });
  });

  it('has nothing to show for a journey with no trains the feeds cover', () => {
    const { result } = renderHook(() => useLiveStatus([metro], base));
    expect(result.current.covered).toBe(false);
  });
});
