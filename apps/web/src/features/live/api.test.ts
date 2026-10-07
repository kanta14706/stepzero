import { describe, expect, it, vi } from 'vitest';
import { LiveFetchError, OPERATOR_BY_FEED, fetchLive, isLiveResponse } from './api';
import { response } from './testing';

const CONFIG = { url: 'https://p.supabase.co', key: 'sb_publishable_x' };
const signal = new AbortController().signal;

const answer = (status: number, body: unknown): typeof fetch =>
  vi.fn(() =>
    Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response),
  );

describe('fetchLive', () => {
  it('asks the function for the operator and trips, with the publishable key only', async () => {
    const f = answer(200, response({}));
    await fetchLive(CONFIG, 'toei', ['A1', 'B2'], signal, f);
    const [url, init] = (f as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://p.supabase.co/functions/v1/live-status?operator=toei&trips=A1,B2');
    expect(init.headers).toEqual({
      apikey: CONFIG.key,
      Authorization: `Bearer ${CONFIG.key}`,
    });
  });

  it('returns the answer, stale or not', async () => {
    const r = await fetchLive(
      CONFIG,
      'toei',
      ['A'],
      signal,
      answer(200, response({}, { status: 'stale' })),
    );
    expect(r.status).toBe('stale');
  });

  it('turns every failure into a code the page can word', async () => {
    const code = async (f: typeof fetch) =>
      fetchLive(CONFIG, 'toei', ['A'], signal, f).catch((e: unknown) => (e as LiveFetchError).code);
    expect(await code(answer(503, { status: 'unavailable' }))).toBe('not_configured');
    expect(await code(answer(502, { status: 'unavailable' }))).toBe('unavailable');
    expect(await code(answer(200, { nonsense: true }))).toBe('unavailable');
    expect(
      await code(vi.fn(() => Promise.reject(new TypeError('network'))) as unknown as typeof fetch),
    ).toBe('unavailable');
  });

  it('lets an abort through, so a replaced request is not reported as a failure', async () => {
    const c = new AbortController();
    c.abort();
    const f = vi.fn(() =>
      Promise.reject(new DOMException('aborted', 'AbortError')),
    ) as unknown as typeof fetch;
    await expect(fetchLive(CONFIG, 'toei', ['A'], c.signal, f)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

describe('isLiveResponse', () => {
  it('needs the parts the app uses', () => {
    expect(isLiveResponse(response({}))).toBe(true);
    expect(isLiveResponse({ ...response({}), status: 'unavailable' })).toBe(false);
    expect(isLiveResponse({ ...response({}), alerts: null })).toBe(false);
    expect(isLiveResponse(null)).toBe(false);
  });
});

describe('OPERATOR_BY_FEED', () => {
  it('matches the feed ids pinned in otp/build.sh', () => {
    expect(OPERATOR_BY_FEED).toEqual({ '1': 'toei', '6': 'jreast', '7': 'keio', '8': 'tobu' });
  });
});
