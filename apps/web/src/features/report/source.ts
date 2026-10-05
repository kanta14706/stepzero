import type { OutageReport, OutageStatus } from '../../routing/types';

/** How fresh the outage reports on screen are. */
export type LiveStatus = 'connecting' | 'live' | 'offline' | 'unavailable';

/** What the community can report (D-022); `blocked` and `data_wrong` come later. */
export type CommunityStatus = Extract<OutageStatus, 'out_of_service' | 'working'>;

export type ReportErrorCode =
  'rate_limited' | 'not_reportable' | 'offline' | 'unavailable' | 'failed';

export class ReportError extends Error {
  constructor(readonly code: ReportErrorCode) {
    super(code);
    this.name = 'ReportError';
  }
}

export interface WatchHandlers {
  /** New or changed reports for the station; `replace` means this is the full set. */
  onReports(reports: OutageReport[], replace: boolean): void;
  onStatus(status: LiveStatus): void;
}

/** Where outage reports come from and go to. The app uses Supabase; tests pass a fake. */
export interface OutageSource {
  /** Follow one station's reports. Returns a function that stops following. */
  watch(stationId: string, handlers: WatchHandlers): () => void;
  /** Report a device (any of its edges) and get back the device's active reports. */
  report(edgeId: string, status: CommunityStatus): Promise<OutageReport[]>;
}

/** Used when no back end is configured: the app works, without live reports. */
export const unavailableSource: OutageSource = {
  watch(_stationId, handlers) {
    handlers.onStatus('unavailable');
    return () => undefined;
  },
  report() {
    return Promise.reject(new ReportError('unavailable'));
  },
};

/** The back end's error codes (`report_outage` raises PTxyz) as a ReportErrorCode. */
export function reportErrorCode(error: { code?: string | undefined } | null): ReportErrorCode {
  switch (error?.code) {
    case 'PT429':
      return 'rate_limited';
    case 'PT404':
      return 'not_reportable';
    case '':
    case undefined:
      // postgrest-js reports a failed fetch with an empty code.
      return 'offline';
    default:
      return 'failed';
  }
}
