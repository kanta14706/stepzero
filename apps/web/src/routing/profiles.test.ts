import { describe, expect, it } from 'vitest';
import { edge } from './fixtures';
import {
  HEAVY_PENALTY,
  LONG_WALK_HEAVY_PENALTY,
  LONG_WALK_PENALTY,
  PENALTY,
  PROFILES,
  UNKNOWN_FACTOR,
  edgeCost,
} from './profiles';
import type { ProfileId } from './types';

const ALL = Object.keys(PROFILES) as ProfileId[];
const stairs = edge('s', 'a', 'b', 'stairs');
const escalator = edge('e', 'a', 'b', 'escalator');
const lift = edge('l', 'a', 'b', 'elevator', { seconds: 40 });
const flat = edge('w', 'a', 'b', 'walk');

describe('stairs and escalators (CLAUDE.md table)', () => {
  it('forbids stairs for wheelchair, walker_cane and stroller_luggage', () => {
    for (const p of ['wheelchair', 'walker_cane', 'stroller_luggage'] as const) {
      expect(edgeCost(p, stairs)).toMatchObject({ cost: Infinity, blocked: 'stairs' });
    }
  });
  it('penalises stairs heavily for low_stamina and allows them for sensory', () => {
    expect(edgeCost('low_stamina', stairs).cost).toBe(10 * HEAVY_PENALTY);
    expect(edgeCost('sensory', stairs).cost).toBe(10);
  });
  it('forbids escalators for wheelchair only; penalises walker_cane heavily, stroller lightly', () => {
    expect(edgeCost('wheelchair', escalator)).toMatchObject({
      cost: Infinity,
      blocked: 'escalator',
    });
    expect(edgeCost('walker_cane', escalator).cost).toBe(10 * HEAVY_PENALTY);
    expect(edgeCost('stroller_luggage', escalator).cost).toBe(10 * PENALTY);
    expect(edgeCost('low_stamina', escalator).cost).toBe(10);
    expect(edgeCost('sensory', escalator).cost).toBe(10);
  });
  it('never forbids an elevator or a fare gate', () => {
    for (const p of ALL) {
      expect(edgeCost(p, lift).cost).toBe(40);
      expect(edgeCost(p, edge('g', 'a', 'b', 'fare_gate', { seconds: 5 })).cost).toBe(5);
    }
  });
});

describe('steep ramps', () => {
  const ramp = (slopePct: number) => edge('r', 'a', 'b', 'ramp', { slopePct });
  it('wheelchair: forbidden above 8%, heavy penalty between 5 and 8%, free up to 5%', () => {
    expect(edgeCost('wheelchair', ramp(18))).toMatchObject({
      cost: Infinity,
      blocked: 'slope_too_steep',
    });
    expect(edgeCost('wheelchair', ramp(8)).cost).toBe(10 * HEAVY_PENALTY);
    expect(edgeCost('wheelchair', ramp(5)).cost).toBe(10);
    expect(edgeCost('wheelchair', ramp(0)).cost).toBe(10);
  });
  it('walker_cane: penalty above 5%, never forbidden', () => {
    expect(edgeCost('walker_cane', ramp(8)).cost).toBe(10 * LONG_WALK_PENALTY * PENALTY);
    expect(edgeCost('walker_cane', ramp(18)).cost).toBe(10 * LONG_WALK_PENALTY * PENALTY);
    expect(edgeCost('walker_cane', ramp(5)).cost).toBe(10 * LONG_WALK_PENALTY);
  });
  it('stroller_luggage: steep ramps are fine', () => {
    expect(edgeCost('stroller_luggage', ramp(18)).cost).toBe(10);
  });
  it('low_stamina: penalty above 5%, heavy above 8%', () => {
    expect(edgeCost('low_stamina', ramp(8)).cost).toBe(10 * LONG_WALK_HEAVY_PENALTY * PENALTY);
    expect(edgeCost('low_stamina', ramp(18)).cost).toBe(
      10 * LONG_WALK_HEAVY_PENALTY * HEAVY_PENALTY,
    );
  });
  it('sensory: ignores slope', () => {
    expect(edgeCost('sensory', ramp(18)).cost).toBe(10);
  });
});

describe('long walks', () => {
  it('penalise walking for walker_cane and heavily for low_stamina only', () => {
    expect(edgeCost('wheelchair', flat).cost).toBe(10);
    expect(edgeCost('stroller_luggage', flat).cost).toBe(10);
    expect(edgeCost('sensory', flat).cost).toBe(10);
    expect(edgeCost('walker_cane', flat).cost).toBe(10 * LONG_WALK_PENALTY);
    expect(edgeCost('low_stamina', flat).cost).toBe(10 * LONG_WALK_HEAVY_PENALTY);
  });
});

describe('steps and width', () => {
  it('wheelchair: forbids steps above 5 cm, penalises 2 to 5 cm', () => {
    expect(edgeCost('wheelchair', edge('w', 'a', 'b', 'walk', { stepHeightCm: 10 }))).toMatchObject(
      {
        cost: Infinity,
        blocked: 'step_too_high',
      },
    );
    expect(edgeCost('wheelchair', edge('w', 'a', 'b', 'walk', { stepHeightCm: 5 })).cost).toBe(
      10 * PENALTY,
    );
    expect(edgeCost('wheelchair', edge('w', 'a', 'b', 'walk', { stepHeightCm: 2 })).cost).toBe(10);
  });
  it('wheelchair: a corridor under 1 m wide is heavily penalised, not forbidden', () => {
    expect(edgeCost('wheelchair', edge('w', 'a', 'b', 'walk', { widthM: 0 })).cost).toBe(
      10 * HEAVY_PENALTY,
    );
    expect(edgeCost('wheelchair', edge('w', 'a', 'b', 'walk', { widthM: 1 })).cost).toBe(10);
  });
  it('ignores the width bucket of an elevator (it describes the cab hop)', () => {
    expect(
      edgeCost('wheelchair', edge('l', 'a', 'b', 'elevator', { widthM: 0, seconds: 40 })).cost,
    ).toBe(40);
  });
});

describe('unknown attributes', () => {
  const unknown = edge('u', 'a', 'b', 'walk', {});
  delete (unknown as { slopePct?: number }).slopePct;
  delete (unknown as { stepHeightCm?: number }).stepHeightCm;

  it('are allowed with a penalty and flagged as uncertain, never treated as flat', () => {
    const c = edgeCost('wheelchair', unknown);
    expect(c).toEqual({ cost: 10 * UNKNOWN_FACTOR, uncertain: true });
  });
  it('do not matter to the sensory profile', () => {
    expect(edgeCost('sensory', unknown)).toEqual({ cost: 10, uncertain: false });
  });
  it('are not flagged when the data is known', () => {
    expect(edgeCost('wheelchair', flat).uncertain).toBe(false);
  });
});

describe('every profile', () => {
  it('has a rule for every field', () => {
    for (const p of ALL) {
      expect(Object.keys(PROFILES[p]).sort()).toEqual(Object.keys(PROFILES.wheelchair).sort());
    }
  });
  it('never produces a cost below the base time', () => {
    for (const p of ALL) {
      for (const e of [stairs, escalator, lift, flat]) {
        expect(edgeCost(p, e).cost).toBeGreaterThanOrEqual(e.seconds);
      }
    }
  });
});
