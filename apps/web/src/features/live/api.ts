import type { SupabaseConfig } from '../report/supabaseSource';
import type { LiveResponse } from './types';

/** OTP feed id (pinned in otp/build.sh) to the operator name the edge function knows. */
export const OPERATOR_BY_FEED: Readonly<Record<string, string>> = {
  '1': 'toei',
  '6': 'jreast',
  '7': 'keio',
  '8': 'tobu',
};

export type LiveFetchErrorCode = 'unavailable' | 'not_configured';

export class LiveFetchError extends Error {
  constructor(readonly code: LiveFetchErrorCode) {
    super(code);
  }
}

/** The parts the app relies on; anything else in the answer is not trusted to exist. */
export function isLiveResponse(x: unknown): x is LiveResponse {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    (r['status'] === 'ok' || r['status'] === 'stale') &&
    typeof r['ageSeconds'] === 'number' &&
    typeof r['trips'] === 'object' &&
    r['trips'] !== null &&
    Array.isArray(r['alerts'])
  );
}

/**
 * Asks the edge function for the live times of some trains. The key sent is the publishable one
 * (safe in the client); the ODPT key stays in the function.
 */
export async function fetchLive(
  config: SupabaseConfig,
  operator: string,
  tripIds: readonly string[],
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<LiveResponse> {
  const url = `${config.url}/functions/v1/live-status?operator=${encodeURIComponent(
    operator,
  )}&trips=${tripIds.map(encodeURIComponent).join(',')}`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      signal,
      headers: { apikey: config.key, Authorization: `Bearer ${config.key}` },
    });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new LiveFetchError('unavailable');
  }
  if (res.status === 503) throw new LiveFetchError('not_configured');
  if (!res.ok) throw new LiveFetchError('unavailable');
  const body: unknown = await res.json().catch(() => null);
  if (!isLiveResponse(body)) throw new LiveFetchError('unavailable');
  return body;
}
