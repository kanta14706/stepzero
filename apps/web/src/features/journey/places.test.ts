import { describe, expect, it, vi } from 'vitest';
import { searchAddresses, searchNamedPlaces, searchPlaces } from './geocode';
import { normalise, searchStations } from './stations';
import type { Station } from './types';

const st = (id: string, ja: string, en: string, code: string, tier: 1 | 2 = 1): Station => ({
  id,
  otpId: `1:${id}`,
  name: { ja, en },
  code,
  lat: 35.6,
  lon: 139.7,
  lines: [],
  tier,
});
const STATIONS = [
  st('109', '大門', 'Daimon', 'A-09'),
  st('421', '大門', 'Daimon', 'E-20', 2),
  st('428', '新宿', 'Shinjuku', 'E-27', 2),
  st('402', '新宿西口', 'Shinjuku-nishiguchi', 'E-01', 2),
  st('410', '新宿三丁目', 'Shinjuku-sanchome', 'S-02'),
];

describe('searchStations', () => {
  it('matches Japanese and English names and station numbers, full detail first', () => {
    expect(searchStations(STATIONS, '大門').map((s) => s.id)).toEqual(['421', '109']);
    expect(searchStations(STATIONS, 'daimon').map((s) => s.id)).toEqual(['421', '109']);
    expect(searchStations(STATIONS, 'ｅ２０').map((s) => s.id)).toEqual(['421']);
    expect(searchStations(STATIONS, '新宿駅').map((s) => s.id)).toEqual(['428', '402', '410']);
    expect(searchStations(STATIONS, 'nishi').map((s) => s.id)).toEqual(['402']);
    expect(searchStations(STATIONS, '  ')).toEqual([]);
  });

  it('normalises width, case, dashes and a trailing 駅', () => {
    expect(normalise('Ｅ－２０')).toBe('e20');
    expect(normalise('新宿駅')).toBe('新宿');
  });
});

const respond = (body: unknown, ok = true) =>
  vi.fn(() =>
    Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as Response),
  ) as unknown as typeof fetch;

describe('address and place search', () => {
  it('keeps Tokyo addresses from 国土地理院', async () => {
    const f = respond([
      {
        geometry: { coordinates: [139.745468, 35.658649] },
        properties: { title: '東京都港区芝公園四丁目２番' },
      },
      { geometry: { coordinates: [141.36, 43.07] }, properties: { title: '北海道札幌市東区' } },
    ]);
    expect(await searchAddresses('芝公園4-2', { fetch: f })).toEqual([
      {
        kind: 'point',
        lat: 35.658649,
        lon: 139.745468,
        label: '東京都港区芝公園四丁目２番',
        source: 'address',
      },
    ]);
  });

  it('labels Nominatim places with their ward, inside Tokyo only', async () => {
    const f = respond([
      {
        lat: '35.6584491',
        lon: '139.7455360',
        name: '東京タワー',
        display_name:
          '東京タワー, 東京タワー通り, 芝公園四丁目, 芝公園, 港区, 東京都, 106-0041, 日本',
      },
      { lat: '34.7', lon: '135.5', name: 'Elsewhere', display_name: 'Elsewhere, 大阪市' },
    ]);
    const places = await searchNamedPlaces('東京タワー', 'ja', { fetch: f });
    expect(places).toEqual([
      {
        kind: 'point',
        lat: 35.6584491,
        lon: 139.745536,
        label: '東京タワー（港区）',
        source: 'place',
      },
    ]);
    const url = (f as unknown as { mock: { calls: [string][] } }).mock.calls[0]?.[0] ?? '';
    expect(url).toContain('bounded=1');
    expect(url).toContain('accept-language=ja');
  });

  it('one search failing does not hide the other', async () => {
    const f = vi.fn((url: string) =>
      url.includes('gsi')
        ? Promise.reject(new TypeError('offline'))
        : Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                { lat: '35.66', lon: '139.75', name: 'A', display_name: 'A, 港区' },
              ]),
          } as Response),
    ) as unknown as typeof fetch;
    const r = await searchPlaces('A', 'ja', { fetch: f });
    expect(r.failed).toEqual(['address']);
    expect(r.places.map((p) => p.label)).toEqual(['A（港区）']);
  });
});
