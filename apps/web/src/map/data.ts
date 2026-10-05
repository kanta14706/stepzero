import type { StationGraph, StationIndex, StationMapData } from './types';

const base = (): string => import.meta.env.BASE_URL.replace(/\/$/, '');

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base()}/data/${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Thrown when the importer output has not been copied into public/data. */
export class DataNotBuiltError extends Error {
  constructor() {
    super('station data has not been built');
  }
}

export async function loadStationIndex(): Promise<StationIndex> {
  try {
    return await getJson<StationIndex>('graphs/index.json');
  } catch {
    throw new DataNotBuiltError();
  }
}

export function loadStationGraph(id: string): Promise<StationGraph> {
  return getJson<StationGraph>(`graphs/${id}.json`);
}

export function loadStationMap(id: string): Promise<StationMapData> {
  return getJson<StationMapData>(`maps/${id}.json`);
}
