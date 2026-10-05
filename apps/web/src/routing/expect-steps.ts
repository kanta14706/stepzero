import { expect } from 'vitest';
import type { Step } from './steps';

/** Test helper. Steps start and end with start/arrive and hand out every leg exactly once, in order. */
export function expectCoversLegs(steps: Step[], legCount: number): void {
  expect(steps[0]?.kind).toBe('start');
  expect(steps[steps.length - 1]?.kind).toBe('arrive');
  let next = 0;
  for (const s of steps) {
    expect(s.legStart).toBe(next);
    expect(s.legEnd).toBeGreaterThanOrEqual(s.legStart);
    if (s.kind !== 'start' && s.kind !== 'arrive') expect(s.legEnd).toBeGreaterThan(s.legStart);
    next = s.legEnd;
  }
  expect(next).toBe(legCount);
}
