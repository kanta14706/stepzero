import { describe, expect, it } from 'vitest';
import { RouterClient } from './client';
import type { WorkerLike } from './client';
import { twoRouteGraph } from './fixtures';
import { handleMessage } from './worker-protocol';
import type { WorkerRequest, WorkerResponse, WorkerState } from './worker-protocol';

describe('worker protocol', () => {
  it('loads a graph and routes on it', () => {
    const state: WorkerState = new Map();
    expect(handleMessage(state, { type: 'load', id: 1, graph: twoRouteGraph() })).toEqual({
      type: 'loaded',
      id: 1,
      stationId: 'T',
    });
    const res = handleMessage(state, {
      type: 'route',
      id: 2,
      stationId: 'T',
      from: ['street'],
      to: ['gate'],
      profile: 'wheelchair',
    });
    expect(res).toMatchObject({ type: 'route', id: 2, result: { ok: true } });
  });

  it('applies outages sent as plain id lists', () => {
    const state: WorkerState = new Map();
    handleMessage(state, { type: 'load', id: 1, graph: twoRouteGraph() });
    const res = handleMessage(state, {
      type: 'route',
      id: 2,
      stationId: 'T',
      from: ['street'],
      to: ['gate'],
      profile: 'wheelchair',
      blockedEdgeIds: ['lift'],
    });
    expect(res).toMatchObject({
      type: 'route',
      result: { ok: false, failure: { reason: 'blocked_by_outage' } },
    });
  });

  it('answers with an error, not silence, for a station that is not loaded', () => {
    expect(
      handleMessage(new Map(), {
        type: 'route',
        id: 9,
        stationId: 'X',
        from: [],
        to: [],
        profile: 'sensory',
      }),
    ).toMatchObject({ type: 'error', id: 9 });
  });
});

describe('RouterClient', () => {
  /** A fake worker that runs the handler synchronously and replies on a microtask. */
  function fakeWorker(): WorkerLike {
    const state: WorkerState = new Map();
    const listeners: ((e: MessageEvent<WorkerResponse>) => void)[] = [];
    return {
      postMessage(msg: WorkerRequest) {
        const response = handleMessage(state, msg);
        queueMicrotask(() => {
          for (const l of listeners) l({ data: response } as MessageEvent<WorkerResponse>);
        });
      },
      addEventListener(_type, listener) {
        listeners.push(listener);
      },
      terminate() {},
    };
  }

  it('resolves load and route calls', async () => {
    const client = new RouterClient(fakeWorker());
    await client.load(twoRouteGraph());
    const { result, ms } = await client.route({
      stationId: 'T',
      from: ['street'],
      to: ['gate'],
      profile: 'sensory',
    });
    expect(result.ok).toBe(true);
    expect(ms).toBeGreaterThanOrEqual(0);
  });

  it('rejects when the worker reports an error', async () => {
    const client = new RouterClient(fakeWorker());
    await expect(
      client.route({ stationId: 'nope', from: [], to: [], profile: 'sensory' }),
    ).rejects.toThrow(/not loaded/);
  });
});
