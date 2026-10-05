import type { OutageReport } from '../../routing/types';
import type { CommunityStatus, OutageSource, WatchHandlers } from './source';

/** An in-memory OutageSource for tests: push reports and statuses by hand. */
export class FakeOutageSource implements OutageSource {
  readonly watchers = new Map<string, WatchHandlers>();
  readonly sent: { edgeId: string; status: CommunityStatus }[] = [];
  /** What `report` answers with; a function so a test can fail it. */
  answer: (edgeId: string, status: CommunityStatus) => Promise<OutageReport[]> = () =>
    Promise.resolve([]);

  watch(stationId: string, handlers: WatchHandlers): () => void {
    this.watchers.set(stationId, handlers);
    handlers.onStatus('connecting');
    return () => {
      if (this.watchers.get(stationId) === handlers) this.watchers.delete(stationId);
    };
  }

  report(edgeId: string, status: CommunityStatus): Promise<OutageReport[]> {
    this.sent.push({ edgeId, status });
    return this.answer(edgeId, status);
  }

  push(stationId: string, reports: OutageReport[], replace = false): void {
    const w = this.watchers.get(stationId);
    if (!w) throw new Error(`nobody watches ${stationId}`);
    w.onReports(reports, replace);
    w.onStatus('live');
  }
}

export function outage(over: Partial<OutageReport> = {}): OutageReport {
  const created = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  return {
    id: 'r1',
    edgeId: 'e1',
    pathwayId: null,
    stationId: 'T',
    status: 'out_of_service',
    createdAt: created.toISOString(),
    expiresAt: new Date(created.getTime() + 6 * 3600_000).toISOString(),
    confirmations: 1,
    source: 'community',
    ...over,
  };
}
