import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeOutageSource, outage } from './fakeSource';
import {
  QUEUE_MAX_AGE_MS,
  createQueuedSource,
  isQueuedAnswer,
  localQueueStore,
  pendingRows,
  stationOfEdge,
} from './queue';
import type { QueueStore, QueuedReport } from './queue';
import { mergeReports } from './rows';
import { ReportError } from './source';
import type { WatchHandlers } from './source';
import type { OutageReport } from '../../routing/types';

const T0 = Date.parse('2026-10-07T09:00:00Z');
const SHAFT = ['421:a', '421:b', '421:c'];
/** A server report active at T0. */
const live = (over: Partial<OutageReport>): OutageReport =>
  outage({
    stationId: '421',
    createdAt: new Date(T0).toISOString(),
    expiresAt: new Date(T0 + 6 * 3600_000).toISOString(),
    ...over,
  });

function memoryStore(initial: QueuedReport[] = []): QueueStore & { queue: QueuedReport[] } {
  return {
    queue: initial,
    read() {
      return this.queue;
    },
    write(q) {
      this.queue = q;
    },
  };
}

function setup(opts: { online?: boolean; store?: ReturnType<typeof memoryStore> } = {}) {
  const inner = new FakeOutageSource();
  const store = opts.store ?? memoryStore();
  const state = { online: opts.online ?? false, now: T0 };
  const source = createQueuedSource(inner, {
    store,
    isOnline: () => state.online,
    deviceEdges: (edgeId) => Promise.resolve(SHAFT.includes(edgeId) ? SHAFT : [edgeId]),
    now: () => state.now,
    events: null,
  });
  return { inner, store, state, source };
}

/** Collects what a watcher sees, merged the way useOutages merges it. */
function watcher(): WatchHandlers & { seen: Map<string, OutageReport> } {
  const w = {
    seen: new Map<string, OutageReport>(),
    onReports(rows: OutageReport[], replace: boolean) {
      w.seen = mergeReports(w.seen, rows, replace, T0);
    },
    onStatus() {
      return undefined;
    },
  };
  return w;
}

describe('createQueuedSource', () => {
  it('sends straight away when online', async () => {
    const { inner, store, source } = setup({ online: true });
    inner.answer = () => Promise.resolve([live({ edgeId: '421:a' })]);
    const rows = await source.report('421:a', 'out_of_service');
    expect(inner.sent).toEqual([{ edgeId: '421:a', status: 'out_of_service' }]);
    expect(isQueuedAnswer(rows)).toBe(false);
    expect(store.queue).toEqual([]);
  });

  it('queues offline and answers with a pending report on every edge of the device', async () => {
    const { inner, store, source } = setup();
    const rows = await source.report('421:b', 'out_of_service');
    expect(inner.sent).toEqual([]);
    expect(isQueuedAnswer(rows)).toBe(true);
    expect(rows.map((r) => r.edgeId)).toEqual(SHAFT);
    expect(rows.every((r) => r.stationId === '421' && r.status === 'out_of_service')).toBe(true);
    expect(store.queue).toHaveLength(1);
  });

  it('queues when the send fails for lack of a connection', async () => {
    const { inner, store, source } = setup({ online: true });
    inner.answer = () => Promise.reject(new ReportError('offline'));
    const rows = await source.report('421:a', 'working');
    expect(isQueuedAnswer(rows)).toBe(true);
    expect(store.queue).toHaveLength(1);
  });

  it('does not queue other failures', async () => {
    const { inner, store, source } = setup({ online: true });
    inner.answer = () => Promise.reject(new ReportError('rate_limited'));
    await expect(source.report('421:a', 'working')).rejects.toThrow('rate_limited');
    expect(store.queue).toEqual([]);
  });

  it('keeps only the latest queued report per device', async () => {
    const { store, source } = setup();
    await source.report('421:a', 'out_of_service');
    await source.report('421:c', 'working');
    expect(store.queue.map((q) => [q.edgeId, q.status])).toEqual([['421:c', 'working']]);
  });

  it('shows pending reports to watchers, also after a full reload', async () => {
    const { inner, source } = setup();
    const w = watcher();
    source.watch('421', w);
    await source.report('421:a', 'out_of_service');
    expect([...w.seen.keys()].sort()).toEqual(SHAFT.map((e) => `queued:${e}`));
    inner.push('421', [live({ id: 'x', edgeId: '421:z' })], true);
    expect(w.seen.has('x')).toBe(true);
    expect(w.seen.has('queued:421:a')).toBe(true);
  });

  it('a new watcher sees what was queued before', async () => {
    const { source } = setup();
    await source.report('421:a', 'out_of_service');
    const w = watcher();
    source.watch('421', w);
    expect(w.seen.size).toBe(3);
  });

  it('sends the queue when back online and replaces the pending copies', async () => {
    const { inner, store, state, source } = setup();
    const w = watcher();
    source.watch('421', w);
    await source.report('421:a', 'out_of_service');
    state.online = true;
    inner.answer = () => Promise.resolve(SHAFT.map((e, i) => live({ id: `s${i}`, edgeId: e })));
    await source.flush();
    expect(inner.sent).toEqual([{ edgeId: '421:a', status: 'out_of_service' }]);
    expect(store.queue).toEqual([]);
    expect([...w.seen.keys()].sort()).toEqual(['s0', 's1', 's2']);
  });

  it('flushes when the station feed goes live', async () => {
    const { inner, state, source } = setup();
    source.watch('421', watcher());
    await source.report('421:a', 'working');
    state.online = true;
    inner.push('421', [], true);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(inner.sent).toEqual([{ edgeId: '421:a', status: 'working' }]);
  });

  it('keeps the report when still offline, and stops', async () => {
    const { inner, store, state, source } = setup();
    await source.report('421:a', 'out_of_service');
    await source.report('402:x', 'out_of_service');
    state.online = true;
    inner.answer = () => Promise.reject(new ReportError('offline'));
    await source.flush();
    expect(inner.sent).toHaveLength(1);
    expect(store.queue.map((q) => [q.edgeId, q.attempts]).sort()).toEqual([
      ['402:x', 0],
      ['421:a', 1],
    ]);
  });

  it('drops a report the back end cannot take', async () => {
    const { inner, store, state, source } = setup();
    const w = watcher();
    source.watch('421', w);
    await source.report('421:a', 'out_of_service');
    state.online = true;
    inner.answer = () => Promise.reject(new ReportError('not_reportable'));
    await source.flush();
    expect(store.queue).toEqual([]);
    expect(w.seen.size).toBe(0);
  });

  it('drops reports queued longer than the limit instead of sending them', async () => {
    const { inner, store, state, source } = setup();
    await source.report('421:a', 'out_of_service');
    state.now = T0 + QUEUE_MAX_AGE_MS + 1;
    state.online = true;
    await source.flush();
    expect(inner.sent).toEqual([]);
    expect(store.queue).toEqual([]);
  });

  it('does not send a report twice when flushed twice at once', async () => {
    const { inner, state, source } = setup();
    await source.report('421:a', 'out_of_service');
    state.online = true;
    await Promise.all([source.flush(), source.flush()]);
    expect(inner.sent).toHaveLength(1);
  });
});

describe('pendingRows', () => {
  const q: QueuedReport = {
    edgeId: '421:a',
    edgeIds: ['421:a', '421:b'],
    stationId: '421',
    status: 'out_of_service',
    queuedAt: new Date(T0).toISOString(),
    attempts: 0,
  };

  it('stay active while the report may still be sent', () => {
    const rows = pendingRows(q);
    expect(Date.parse(rows[0]?.expiresAt ?? '')).toBe(T0 + QUEUE_MAX_AGE_MS);
    expect(mergeReports(new Map(), rows, false, T0).size).toBe(2);
  });

  it('ended copies remove them', () => {
    const current = mergeReports(new Map(), pendingRows(q), false, T0);
    expect(mergeReports(current, pendingRows(q, true), false, T0).size).toBe(0);
  });
});

describe('localQueueStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('survives a reload and ignores entries that are not reports', () => {
    const item: QueuedReport = {
      edgeId: '421:a',
      edgeIds: ['421:a'],
      stationId: '421',
      status: 'working',
      queuedAt: new Date(T0).toISOString(),
      attempts: 0,
    };
    localQueueStore('k').write([item]);
    localStorage.setItem('k2', JSON.stringify([item, { edgeId: 3 }]));
    expect(localQueueStore('k').read()).toEqual([item]);
    expect(localQueueStore('k2').read()).toEqual([item]);
  });

  it('reads garbage as an empty queue', () => {
    localStorage.setItem('k', '{not json');
    expect(localQueueStore('k').read()).toEqual([]);
  });
});

it('stationOfEdge', () => {
  expect(stationOfEdge('421:hokonavi:abc')).toBe('421');
});
