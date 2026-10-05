/**
 * Address and place search for journey ends that are not stations (step 2.4, D-024).
 *
 * - Addresses: 国土地理院 address search (msearch.gsi.go.jp), free, no key.
 * - Places (buildings, parks, shops): OpenStreetMap Nominatim, only on an explicit search (never
 *   while typing), as its usage policy asks.
 *
 * Both only see the text the person searches for. Results outside Tokyo are dropped.
 */
import type { Place } from './types';

type PointPlace = Extract<Place, { kind: 'point' }>;

export const GSI_URL = 'https://msearch.gsi.go.jp/address-search/AddressSearch';
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

/** Tokyo (wards and Tama) with a margin: [minLon, minLat, maxLon, maxLat]. */
const TOKYO: [number, number, number, number] = [138.9, 35.45, 140.0, 35.95];

const inTokyo = (lat: number, lon: number): boolean =>
  lon >= TOKYO[0] && lon <= TOKYO[2] && lat >= TOKYO[1] && lat <= TOKYO[3];

interface GsiFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: { title?: string };
}

export async function searchAddresses(
  query: string,
  { fetch: f = fetch, signal }: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<PointPlace[]> {
  const res = await f(`${GSI_URL}?q=${encodeURIComponent(query)}`, signal ? { signal } : {});
  if (!res.ok) throw new Error(`address search: HTTP ${res.status}`);
  const features = (await res.json()) as GsiFeature[];
  const out: PointPlace[] = [];
  for (const ft of Array.isArray(features) ? features : []) {
    const [lon, lat] = ft.geometry?.coordinates ?? [];
    const label = ft.properties?.title;
    // The service also matches fragments anywhere in Japan; keep Tokyo addresses only.
    if (typeof lat !== 'number' || typeof lon !== 'number' || !label) continue;
    if (!inTokyo(lat, lon) || !label.startsWith('東京都')) continue;
    out.push({ kind: 'point', lat, lon, label, source: 'address' });
  }
  return out.slice(0, 5);
}

interface NominatimHit {
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
}

export async function searchNamedPlaces(
  query: string,
  lang: string,
  { fetch: f = fetch, signal }: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<PointPlace[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '5',
    countrycodes: 'jp',
    viewbox: `${TOKYO[0]},${TOKYO[3]},${TOKYO[2]},${TOKYO[1]}`,
    bounded: '1',
    'accept-language': lang,
  });
  const res = await f(`${NOMINATIM_URL}?${params.toString()}`, signal ? { signal } : {});
  if (!res.ok) throw new Error(`place search: HTTP ${res.status}`);
  const hits = (await res.json()) as NominatimHit[];
  const out: PointPlace[] = [];
  for (const h of Array.isArray(hits) ? hits : []) {
    const lat = Number(h.lat);
    const lon = Number(h.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inTokyo(lat, lon)) continue;
    // "東京タワー, 東京タワー通り, 芝公園四丁目, 芝公園, 港区, ..." -> name plus the ward.
    const parts = (h.display_name ?? '').split(',').map((p) => p.trim());
    const ward = parts.find((p) => /[区市町村]$/.test(p) || /(City|Ward)$/.test(p));
    const name = h.name || parts[0];
    if (!name) continue;
    out.push({
      kind: 'point',
      lat,
      lon,
      label: ward && ward !== name ? `${name}（${ward}）` : name,
      source: 'place',
    });
  }
  return out;
}

export interface PlaceSearchResult {
  places: PointPlace[];
  /** Searches that failed (the other one's results are still returned). */
  failed: ('address' | 'place')[];
}

/** Both searches at once; one failing does not hide the other's results. */
export async function searchPlaces(
  query: string,
  lang: string,
  opts: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<PlaceSearchResult> {
  const [addresses, named] = await Promise.allSettled([
    searchAddresses(query, opts),
    searchNamedPlaces(query, lang, opts),
  ]);
  if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
  const failed: PlaceSearchResult['failed'] = [];
  const places: PointPlace[] = [];
  if (named.status === 'fulfilled') places.push(...named.value);
  else failed.push('place');
  if (addresses.status === 'fulfilled') places.push(...addresses.value);
  else failed.push('address');
  return { places, failed };
}
