/**
 * The last planned journey, kept on the device for when there is no connection (step 2.9,
 * D-025). What is kept is OTP's answer (the train itineraries and street walks), not the
 * finished journey: offline, the app assembles it again from the precached station graphs, so
 * outage reports known on the device (including the person's own, queued) still change it.
 */
import type { JourneyRequest, Itinerary } from './types';
import { encodePlace, journeyHref } from './url';

export type WalkAnswer = { distanceM: number; seconds: number } | null;

export interface SavedPlan {
  version: 1;
  /** When the plan was made (ISO). */
  savedAt: string;
  /** From, to and profile: which requests the plan answers. */
  key: string;
  /** Opens the same trip ("now"); offline it shows this plan. */
  href: string;
  /** The departure time the plan was made for (ISO). */
  time: string;
  itineraries: Itinerary[];
  /** Street walks by "fromLat,fromLon,toLat,toLon". */
  walks: [string, WalkAnswer][];
}

export interface PlanStore {
  load(): SavedPlan | null;
  save(plan: SavedPlan): void;
}

/** The time is left out: offline, the saved plan answers the same trip at any time asked. */
export function planKey(r: Pick<JourneyRequest, 'from' | 'to' | 'profile'>): string {
  return `${encodePlace(r.from)}|${encodePlace(r.to)}|${r.profile}`;
}

export function savedPlan(
  request: JourneyRequest,
  itineraries: Itinerary[],
  walks: [string, WalkAnswer][],
  now: Date = new Date(),
): SavedPlan {
  return {
    version: 1,
    savedAt: now.toISOString(),
    key: planKey(request),
    href: journeyHref(request.from, request.to, request.profile, null),
    time: request.time,
    itineraries,
    walks,
  };
}

function isSavedPlan(x: unknown): x is SavedPlan {
  if (typeof x !== 'object' || x === null) return false;
  const p = x as Record<string, unknown>;
  return (
    p['version'] === 1 &&
    typeof p['savedAt'] === 'string' &&
    typeof p['key'] === 'string' &&
    typeof p['href'] === 'string' &&
    typeof p['time'] === 'string' &&
    !Number.isNaN(Date.parse(p['time'])) &&
    Array.isArray(p['itineraries']) &&
    Array.isArray(p['walks'])
  );
}

const listeners = new Set<() => void>();

/** One plan in localStorage. Nothing is kept when storage is blocked; the app still works. */
export function localPlanStore(key = 'stepzero.lastJourney'): PlanStore {
  return {
    load() {
      try {
        const raw = localStorage.getItem(key);
        const parsed: unknown = raw === null ? null : JSON.parse(raw);
        return isSavedPlan(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    save(plan) {
      try {
        localStorage.setItem(key, JSON.stringify(plan));
      } catch {
        return;
      }
      for (const l of listeners) l();
    },
  };
}

export const defaultPlanStore: PlanStore = localPlanStore();

/** For useSyncExternalStore: called when a plan is saved in this tab. */
export function subscribeSavedPlan(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
