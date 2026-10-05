import { describe, expect, it } from 'vitest';
import {
  decodePlace,
  encodePlace,
  journeyHref,
  parseJourneyParams,
  tokyoIso,
  tokyoNowLocal,
} from './url';
import type { Place, Station } from './types';

const DAIMON: Station = {
  id: '421',
  otpId: '1:421',
  name: { ja: '大門' },
  lat: 0,
  lon: 0,
  lines: [],
  tier: 2,
};

describe('journey URLs', () => {
  it('round-trips stations and points, labels with commas included', () => {
    const tower: Place = {
      kind: 'point',
      lat: 35.65858,
      lon: 139.74543,
      label: '東京タワー, 港区',
      source: 'place',
    };
    const href = journeyHref(
      { kind: 'station', station: DAIMON },
      tower,
      'walker_cane',
      '2026-10-07T09:00',
    );
    const p = parseJourneyParams(href.slice('#/journey?'.length));
    expect(p.profile).toBe('walker_cane');
    expect(p.at).toBe('2026-10-07T09:00');
    expect(decodePlace(p.from, [DAIMON])).toEqual({ kind: 'station', station: DAIMON });
    expect(decodePlace(p.to, [])).toEqual(tower);
    expect(encodePlace(tower)).toBe('point:35.658580,139.745430,place,東京タワー, 港区');
  });

  it('ignores what it cannot read', () => {
    const p = parseJourneyParams('profile=flying&at=tomorrow');
    expect(p).toEqual({ from: null, to: null, profile: 'wheelchair', at: null });
    expect(decodePlace('station:999', [DAIMON])).toBeNull();
    expect(decodePlace('point:x,y,place,a', [])).toBeNull();
  });

  it('works in Tokyo time whatever the device time zone', () => {
    expect(tokyoIso('2026-10-07T09:00')).toBe('2026-10-07T09:00:00+09:00');
    expect(tokyoNowLocal(new Date('2026-10-06T23:30:00Z'))).toBe('2026-10-07T08:30');
  });
});
