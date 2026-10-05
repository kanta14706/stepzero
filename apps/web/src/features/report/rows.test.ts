import { describe, expect, it } from 'vitest';
import type { OutageReport } from '../../routing/types';
import { fromRow, fromRows, mergeReports, nextExpiry } from './rows';
import { reportErrorCode } from './source';
import { supabaseConfig } from './supabaseSource';

const ROW = {
  id: 'r1',
  episode_id: 'ep',
  edge_id: '424:hokonavi:e1',
  device_id: '424:elevator:e1',
  pathway_id: '424L0239',
  station_id: '424',
  status: 'out_of_service',
  created_at: '2026-10-06T10:00:00+00:00',
  expires_at: '2026-10-06T16:00:00+00:00',
  confirmations: 2,
  source: 'community',
};

function report(over: Partial<OutageReport>): OutageReport {
  const r = fromRow(ROW);
  if (!r) throw new Error('fixture');
  return { ...r, ...over };
}

const T = (iso: string) => Date.parse(iso);

describe('fromRow', () => {
  it('turns a database row into an OutageReport', () => {
    expect(fromRow(ROW)).toEqual({
      id: 'r1',
      edgeId: '424:hokonavi:e1',
      pathwayId: '424L0239',
      stationId: '424',
      status: 'out_of_service',
      createdAt: '2026-10-06T10:00:00+00:00',
      expiresAt: '2026-10-06T16:00:00+00:00',
      confirmations: 2,
      source: 'community',
    });
  });
  it('accepts a missing pathway id as null', () => {
    expect(fromRow({ ...ROW, pathway_id: null })?.pathwayId).toBeNull();
  });
  it.each([
    ['unknown status', { status: 'exploded' }],
    ['missing edge', { edge_id: undefined }],
    ['bad date', { expires_at: 'soon' }],
    ['bad source', { source: 'someone' }],
    ['confirmations as text', { confirmations: '2' }],
  ])('rejects a row with %s', (_name, over) => {
    expect(fromRow({ ...ROW, ...over })).toBeNull();
  });
  it('skips bad rows in a list and ignores non-lists', () => {
    expect(fromRows([ROW, { nope: true }, null])).toHaveLength(1);
    expect(fromRows(null)).toEqual([]);
  });
});

describe('mergeReports', () => {
  const now = T('2026-10-06T11:00:00Z');
  it('adds reports, and a later copy of the same id replaces the earlier one', () => {
    const a = mergeReports(new Map(), [report({})], false, now);
    const b = mergeReports(a, [report({ confirmations: 3 })], false, now);
    expect(b.get('r1')?.confirmations).toBe(3);
    expect(b.size).toBe(1);
  });
  it('starts from scratch on a full reload', () => {
    const a = mergeReports(new Map(), [report({ id: 'old' })], false, now);
    expect([...mergeReports(a, [report({})], true, now).keys()]).toEqual(['r1']);
  });
  it('drops expired reports and reports the server ended', () => {
    const merged = mergeReports(
      new Map(),
      [
        report({ id: 'expired', expiresAt: '2026-10-06T10:59:00Z' }),
        report({ id: 'ended', expiresAt: '2026-10-06T10:00:00+00:00' }),
        report({ id: 'active' }),
      ],
      false,
      now,
    );
    expect([...merged.keys()]).toEqual(['active']);
  });
});

describe('nextExpiry', () => {
  it('is the earliest future expiry, or null', () => {
    const now = T('2026-10-06T11:00:00Z');
    const rs = [
      report({ expiresAt: '2026-10-06T15:00:00Z' }),
      report({ expiresAt: '2026-10-06T12:00:00Z' }),
      report({ expiresAt: '2026-10-06T10:00:00Z' }),
    ];
    expect(nextExpiry(rs, now)).toBe(T('2026-10-06T12:00:00Z'));
    expect(nextExpiry([], now)).toBeNull();
  });
});

describe('reportErrorCode', () => {
  it('maps the back end codes', () => {
    expect(reportErrorCode({ code: 'PT429' })).toBe('rate_limited');
    expect(reportErrorCode({ code: 'PT404' })).toBe('not_reportable');
    expect(reportErrorCode({ code: '' })).toBe('offline');
    expect(reportErrorCode({ code: '42501' })).toBe('failed');
  });
});

describe('supabaseConfig', () => {
  it('needs both the URL and the publishable key', () => {
    expect(supabaseConfig({})).toBeNull();
    expect(supabaseConfig({ VITE_SUPABASE_URL: 'http://x' })).toBeNull();
    expect(
      supabaseConfig({ VITE_SUPABASE_URL: 'http://x', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' }),
    ).toEqual({ url: 'http://x', key: 'k' });
  });
});
