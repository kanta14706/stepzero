import type { NodeId, ProfileId, RouteResult, StationGraph } from './types';
import { handleMessage } from './worker-protocol';
import type { WorkerRequest, WorkerResponse, WorkerState } from './worker-protocol';

/** The part of `Worker` the client uses, so tests can pass a fake. */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerResponse>) => void): void;
  terminate(): void;
}

export interface RouteQuery {
  stationId: string;
  from: NodeId[];
  to: NodeId[];
  profile: ProfileId;
  blockedEdgeIds?: string[];
  blockedPathwayIds?: string[];
  fromCost?: Record<NodeId, number>;
  toCost?: Record<NodeId, number>;
}

/** Promise wrapper around the router worker. */
export class RouterClient {
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }
  >();

  constructor(private readonly worker: WorkerLike) {
    worker.addEventListener('message', (event) => {
      const entry = this.pending.get(event.data.id);
      if (!entry) return;
      this.pending.delete(event.data.id);
      if (event.data.type === 'error') entry.reject(new Error(event.data.message));
      else entry.resolve(event.data);
    });
  }

  private send(build: (id: number) => WorkerRequest): Promise<WorkerResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(build(id));
    });
  }

  async load(graph: StationGraph): Promise<void> {
    await this.send((id) => ({ type: 'load', id, graph }));
  }

  async route(query: RouteQuery): Promise<{ result: RouteResult; ms: number }> {
    const response = await this.send((id) => ({ type: 'route', id, ...query }));
    if (response.type !== 'route') throw new Error(`unexpected response ${response.type}`);
    return { result: response.result, ms: response.ms };
  }

  dispose(): void {
    this.worker.terminate();
    for (const { reject } of this.pending.values()) reject(new Error('router disposed'));
    this.pending.clear();
  }
}

/** The real thing, for the app. Vite bundles the worker from this URL. */
export function createRouterWorker(): Worker {
  return new Worker(new URL('./router.worker.ts', import.meta.url), { type: 'module' });
}

/**
 * Runs the router on the calling thread, with the same message protocol as the worker. Used when
 * there is no `Worker` (very old browsers, jsdom tests); routes are short enough (a few ms) that
 * this stays within the re-route budget.
 */
export function createInlineWorker(): WorkerLike {
  const state: WorkerState = new Map();
  const listeners: ((event: MessageEvent<WorkerResponse>) => void)[] = [];
  return {
    postMessage(message) {
      queueMicrotask(() => {
        const data = handleMessage(state, message);
        for (const l of listeners) l({ data } as MessageEvent<WorkerResponse>);
      });
    },
    addEventListener(_type, listener) {
      listeners.push(listener);
    },
    terminate() {
      listeners.length = 0;
      state.clear();
    },
  };
}

/** The Web Worker when the browser has one, otherwise the inline fallback. */
export function createRouter(): WorkerLike {
  return typeof Worker === 'undefined' ? createInlineWorker() : createRouterWorker();
}
