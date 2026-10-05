/// <reference lib="webworker" />
import { handleMessage } from './worker-protocol';
import type { WorkerRequest, WorkerState } from './worker-protocol';

const state: WorkerState = new Map();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    self.postMessage(handleMessage(state, event.data));
  } catch (err) {
    self.postMessage({
      type: 'error',
      id: event.data.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
