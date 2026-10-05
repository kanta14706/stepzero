/**
 * Journeys live in the URL (`#/journey?from=station:421&to=station:428&profile=wheelchair`), so
 * a plan survives a reload and can be shared. `at` is the departure time; without it, "now".
 */
import { PROFILES } from '../../routing/profiles';
import type { ProfileId } from '../../routing/types';
import type { Place, Station } from './types';

export interface JourneyParams {
  from: string | null;
  to: string | null;
  profile: ProfileId;
  /** Local Tokyo time "YYYY-MM-DDTHH:MM", or null for now. */
  at: string | null;
}

const isProfile = (p: string | null): p is ProfileId => p !== null && p in PROFILES;

export function parseJourneyParams(params: string): JourneyParams {
  const q = new URLSearchParams(params);
  const at = q.get('at');
  return {
    from: q.get('from'),
    to: q.get('to'),
    profile: isProfile(q.get('profile')) ? (q.get('profile') as ProfileId) : 'wheelchair',
    at: at && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at) ? at : null,
  };
}

/** "station:421" or "point:35.65858,139.74543,place,東京タワー（港区）". */
export function encodePlace(place: Place): string {
  if (place.kind === 'station') return `station:${place.station.id}`;
  return `point:${place.lat.toFixed(6)},${place.lon.toFixed(6)},${place.source},${place.label}`;
}

export function decodePlace(value: string | null, stations: readonly Station[]): Place | null {
  if (!value) return null;
  if (value.startsWith('station:')) {
    const id = value.slice('station:'.length);
    const station = stations.find((s) => s.id === id);
    return station ? { kind: 'station', station } : null;
  }
  const m = /^point:(-?[\d.]+),(-?[\d.]+),(address|place),(.+)$/s.exec(value);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { kind: 'point', lat, lon, source: m[3] as 'address' | 'place', label: m[4] ?? '' };
}

export function journeyHref(from: Place, to: Place, profile: ProfileId, at: string | null): string {
  const q = new URLSearchParams({ from: encodePlace(from), to: encodePlace(to), profile });
  if (at) q.set('at', at);
  return `#/journey?${q.toString()}`;
}

/** "2026-10-07T09:00" in Tokyo time to an ISO time with the +09:00 offset. */
export function tokyoIso(local: string): string {
  return `${local}:00+09:00`;
}

/** The current time in Tokyo as "YYYY-MM-DDTHH:MM" (for the time field's default). */
export function tokyoNowLocal(now: Date = new Date()): string {
  const t = new Date(now.getTime() + 9 * 3600_000);
  return t.toISOString().slice(0, 16);
}
