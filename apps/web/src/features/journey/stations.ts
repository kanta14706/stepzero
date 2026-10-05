import { getJson } from '../../map/data';
import type { Station, StationList } from './types';

let cached: Promise<StationList> | null = null;

/** The station list written by the importer (data/stations.json), fetched once. */
export function loadStations(): Promise<StationList> {
  cached ??= getJson<StationList>('stations.json').catch((e: unknown) => {
    cached = null;
    throw e;
  });
  return cached;
}

/** Test hook. */
export function resetStationsCache(): void {
  cached = null;
}

/** Full-width to half-width, lower case, no spaces, dashes or dots: "Ｅ－２０" and "e20" match. */
export function normalise(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-‐ー・.'’]/g, '')
    .replace(/駅$/, '');
}

/**
 * Stations whose name (any language) or number matches the query. Exact matches first, then
 * names that start with it, then names that contain it; stations with full detail first within
 * each group.
 */
export function searchStations(stations: readonly Station[], query: string, limit = 8): Station[] {
  const q = normalise(query);
  if (!q) return [];
  const scored: { s: Station; score: number }[] = [];
  for (const s of stations) {
    const keys = [...Object.values(s.name), s.code ?? '']
      .filter(Boolean)
      .map((k) => normalise(k as string));
    let score = Infinity;
    for (const k of keys) {
      if (k === q) score = Math.min(score, 0);
      else if (k.startsWith(q)) score = Math.min(score, 1);
      else if (k.includes(q)) score = Math.min(score, 2);
    }
    if (score < Infinity) scored.push({ s, score: score * 2 + (s.tier === 2 ? 0 : 1) });
  }
  return scored
    .sort((a, b) => a.score - b.score || (a.s.code ?? '~').localeCompare(b.s.code ?? '~'))
    .slice(0, limit)
    .map((x) => x.s);
}
