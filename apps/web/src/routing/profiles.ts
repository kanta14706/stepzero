import type { BlockReason, EdgeMode, GraphEdge, ProfileId } from './types';

/**
 * Routing profiles (CLAUDE.md "Routing profiles"). A profile turns an edge into a cost:
 * `seconds` times a multiplier, where `Infinity` means the edge is forbidden.
 *
 * The penalty sizes are assumptions to be tuned after the user tests; they are named so the
 * tests can pin them.
 */
export const PENALTY = 2.5;
export const HEAVY_PENALTY = 8;
/** Applied when the data does not say how steep or high an edge is. */
export const UNKNOWN_FACTOR = 1.5;
export const LONG_WALK_PENALTY = 1.3;
export const LONG_WALK_HEAVY_PENALTY = 2;

export type Rule = 'ok' | 'penalty' | 'heavy' | 'forbidden';

export interface ProfileRules {
  stairs: Rule;
  escalator: Rule;
  /** Slope above 5% (the 5-8% bucket, stored as 8). */
  slopeOver5: Rule;
  /** Slope above 8% (stored as 18). */
  slopeOver8: Rule;
  /** Step above 2 cm (the 2-5 cm bucket, stored as 5). */
  stepOver2: Rule;
  /** Step above 5 cm (stored as 10). */
  stepOver5: Rule;
  /** Corridor under 1.0 m wide. */
  narrow: Rule;
  /** Cost of walking itself: ok, penalty (x1.3) or heavy (x2). */
  longWalk: Rule;
  /** Whether slope and step data matter at all (sensory ignores them). */
  caresAboutSlopeAndSteps: boolean;
}

export const PROFILES: Record<ProfileId, ProfileRules> = {
  wheelchair: {
    stairs: 'forbidden',
    escalator: 'forbidden',
    slopeOver5: 'heavy',
    slopeOver8: 'forbidden',
    stepOver2: 'penalty',
    stepOver5: 'forbidden',
    narrow: 'heavy',
    longWalk: 'ok',
    caresAboutSlopeAndSteps: true,
  },
  walker_cane: {
    stairs: 'forbidden',
    escalator: 'heavy',
    slopeOver5: 'penalty',
    slopeOver8: 'penalty',
    stepOver2: 'penalty',
    stepOver5: 'heavy',
    narrow: 'ok',
    longWalk: 'penalty',
    caresAboutSlopeAndSteps: true,
  },
  stroller_luggage: {
    stairs: 'forbidden',
    escalator: 'penalty',
    slopeOver5: 'ok',
    slopeOver8: 'ok',
    stepOver2: 'ok',
    stepOver5: 'heavy',
    narrow: 'ok',
    longWalk: 'ok',
    caresAboutSlopeAndSteps: true,
  },
  low_stamina: {
    stairs: 'heavy',
    escalator: 'ok',
    slopeOver5: 'penalty',
    slopeOver8: 'heavy',
    stepOver2: 'ok',
    stepOver5: 'ok',
    narrow: 'ok',
    longWalk: 'heavy',
    caresAboutSlopeAndSteps: true,
  },
  // "avoid crowded hubs where known": there is no crowding data yet, so nothing to avoid.
  sensory: {
    stairs: 'ok',
    escalator: 'ok',
    slopeOver5: 'ok',
    slopeOver8: 'ok',
    stepOver2: 'ok',
    stepOver5: 'ok',
    narrow: 'ok',
    longWalk: 'ok',
    caresAboutSlopeAndSteps: false,
  },
};

const MULTIPLIER: Record<Rule, number> = {
  ok: 1,
  penalty: PENALTY,
  heavy: HEAVY_PENALTY,
  forbidden: Infinity,
};

export interface EdgeCost {
  /** Seconds as the profile sees them; `Infinity` when forbidden. */
  cost: number;
  blocked?: BlockReason;
  /** True when a cost depends on a slope or step height that the data does not give. */
  uncertain: boolean;
}

const WALKING: ReadonlySet<EdgeMode> = new Set(['walk', 'ramp', 'moving_walkway']);

const LONG_WALK_FACTOR: Record<Rule, number> = {
  ok: 1,
  penalty: LONG_WALK_PENALTY,
  heavy: LONG_WALK_HEAVY_PENALTY,
  forbidden: 1,
};

/** Cost of one edge for a profile. Pure: outages are handled separately. */
export function edgeCost(profile: ProfileId, edge: GraphEdge): EdgeCost {
  const rules = PROFILES[profile];
  const base = edge.seconds;

  if (edge.mode === 'stairs') {
    const m = MULTIPLIER[rules.stairs];
    return m === Infinity
      ? { cost: Infinity, blocked: 'stairs', uncertain: false }
      : { cost: base * m, uncertain: false };
  }
  if (edge.mode === 'escalator') {
    const m = MULTIPLIER[rules.escalator];
    return m === Infinity
      ? { cost: Infinity, blocked: 'escalator', uncertain: false }
      : { cost: base * m, uncertain: false };
  }
  // Lifts and gates: their slope, step and width buckets describe the cab hop, not a corridor.
  if (edge.mode === 'elevator' || edge.mode === 'fare_gate') {
    return { cost: base, uncertain: false };
  }

  let multiplier = 1;
  let uncertain = false;

  if (WALKING.has(edge.mode)) multiplier *= LONG_WALK_FACTOR[rules.longWalk];

  if (rules.caresAboutSlopeAndSteps) {
    const slope = edge.slopePct;
    if (slope === undefined) {
      uncertain = true;
    } else {
      if (slope > 8) {
        const m = MULTIPLIER[rules.slopeOver8];
        if (m === Infinity) return { cost: Infinity, blocked: 'slope_too_steep', uncertain: false };
        multiplier *= m;
      } else if (slope > 5) {
        const m = MULTIPLIER[rules.slopeOver5];
        if (m === Infinity) return { cost: Infinity, blocked: 'slope_too_steep', uncertain: false };
        multiplier *= m;
      }
    }

    const step = edge.stepHeightCm;
    if (step === undefined) {
      uncertain = true;
    } else {
      if (step > 5) {
        const m = MULTIPLIER[rules.stepOver5];
        if (m === Infinity) return { cost: Infinity, blocked: 'step_too_high', uncertain: false };
        multiplier *= m;
      } else if (step > 2) {
        const m = MULTIPLIER[rules.stepOver2];
        if (m === Infinity) return { cost: Infinity, blocked: 'step_too_high', uncertain: false };
        multiplier *= m;
      }
    }

    // Width is stored as a lower bound: 0 means "under 1.0 m".
    if (edge.widthM !== undefined && edge.widthM < 1) multiplier *= MULTIPLIER[rules.narrow];
  }

  if (uncertain) multiplier *= UNKNOWN_FACTOR;
  return { cost: base * multiplier, uncertain };
}
