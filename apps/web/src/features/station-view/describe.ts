/**
 * Step text: turns the language-free steps from `routing/steps.ts` into sentences in the user's
 * language. Each step is one main sentence plus notes (slopes, missing data, floor changes).
 * Nothing here invents information the data does not have; where it is missing, the text says so.
 */
import { fmt } from '../../i18n';
import type { Dictionary } from '../../i18n/ja';
import type { BoardingPosition } from '../../routing/boarding';
import type { Place, Step } from '../../routing/steps';
import type { AlternativeCode, BlockReason, Names, NoRoute, ProfileId } from '../../routing/types';

export interface StepText {
  text: string;
  notes: string[];
}

/** Profiles that need the wide fare gate. */
const WIDE_GATE: ReadonlySet<ProfileId> = new Set(['wheelchair', 'stroller_luggage']);
/** An elevator this close to an entrance is "at" it. */
const AT_ENTRANCE_M = 5;
/** `slopePct` stores the upper bound of the bucket; 18 means "over 8%". */
const STEEP_BUCKET = 18;

/** Short distances to the metre, longer ones to 5 m: the data is not more precise than that. */
export function roundMetres(m: number): number {
  return m < 10 ? Math.max(1, Math.round(m)) : Math.round(m / 5) * 5;
}

/** Floor name for step text. The ground is "street level", not a floor number. */
export function stepFloor(panel: number, t: Dictionary): string {
  if (panel === 0) return t.steps.groundFloor;
  return panel < 0 ? fmt(t.floorBelow, { n: -panel }) : fmt(t.floorAbove, { n: panel });
}

/** A place name in the page language, or in Japanese when the data has no translation. */
export function nameIn(names: Names, lang: string): string {
  return names[lang] ?? names['ja'] ?? '';
}

/**
 * Where to be on the train, for the platform end of a route. `end` is 'arrive' when the route
 * ends on the platform (the person boards here) and 'start' when it starts there (the person got
 * off a train here, so the advice is where to ride).
 */
export function boardingNotes(
  b: BoardingPosition,
  end: 'start' | 'arrive',
  t: Dictionary,
  lang: string,
): string[] {
  const s = t.steps;
  const part = s.parts[b.part];
  const notes: string[] = [];
  if (end === 'arrive') {
    if (b.terminating === 'all' || b.nextStop === null) notes.push(s.boardingInTerminating);
    else notes.push(fmt(s.boardingIn, { next: nameIn(b.nextStop, lang), part }));
  } else if (b.nextStop === null) {
    notes.push(fmt(s.boardingOutTerminating, { part }));
  } else {
    notes.push(fmt(s.boardingOut, { next: nameIn(b.nextStop, lang), part }));
  }
  if (notes[0] === s.boardingInTerminating) return notes;
  if (b.confidence === 'weak') notes.push(s.boardingWeak);
  if (b.approximate) notes.push(s.boardingApproximate);
  notes.push(s.boardingNoCar);
  return notes;
}

function platformName(code: string | null, t: Dictionary): string {
  return code === null ? t.steps.platformUnnamed : fmt(t.steps.platform, { code });
}

function placeText(place: Place, end: 'start' | 'arrive', t: Dictionary): string {
  const s = t.steps;
  switch (place.type) {
    case 'entrance':
      return place.label === null
        ? end === 'start'
          ? s.startEntranceUnnamed
          : s.arriveEntranceUnnamed
        : fmt(end === 'start' ? s.startEntrance : s.arriveEntrance, { label: place.label });
    case 'street':
      return end === 'start' ? s.startStreet : s.arriveStreet;
    case 'platform':
      return fmt(end === 'start' ? s.startPlatform : s.arrivePlatform, {
        platform: platformName(place.code, t),
      });
    case 'other':
      return end === 'start' ? s.startOther : s.arriveOther;
  }
}

export function describeStep(
  step: Step,
  t: Dictionary,
  profile: ProfileId,
  lang: string,
): StepText {
  const s = t.steps;
  const notes: string[] = [];
  const vertical = (dir: 'up' | 'down') => (dir === 'up' ? s.goUp : s.goDown);
  let text: string;

  switch (step.kind) {
    case 'start':
    case 'arrive':
      text = placeText(step.place, step.kind, t);
      if (step.place.type === 'platform' && step.place.boarding) {
        notes.push(...boardingNotes(step.place.boarding, step.kind, t, lang));
      }
      break;

    case 'walk': {
      const m = roundMetres(step.lengthM);
      const target = step.target === null ? null : s.targets[step.target];
      if (step.turn === null) {
        text = target === null ? fmt(s.walkNoTurn, { m }) : fmt(s.walkNoTurnTo, { m, target });
      } else {
        const turn = s.turns[step.turn];
        text = target === null ? fmt(s.walk, { turn, m }) : fmt(s.walkTo, { turn, m, target });
      }
      if (step.toPanel !== step.panel) {
        notes.push(fmt(s.walkFloor, { floor: stepFloor(step.toPanel, t) }));
      }
      const { count, lengthM, maxSlopePct } = step.ramps;
      if (count > 0) {
        const rm = roundMetres(lengthM);
        if (maxSlopePct === null) notes.push(fmt(s.rampUnknown, { m: rm }));
        else if (maxSlopePct >= STEEP_BUCKET) notes.push(fmt(s.rampSteep, { m: rm }));
        else if (maxSlopePct > 0) notes.push(fmt(s.ramp, { m: rm, pct: maxSlopePct }));
      }
      if (step.movingWalkway) notes.push(s.movingWalkway);
      break;
    }

    case 'elevator': {
      if (step.direction === 'unknown') {
        text = s.elevatorSameFloor;
        break;
      }
      const values = { floor: stepFloor(step.toPanel, t), dir: vertical(step.direction) };
      const e = step.entrance;
      if (e === null) text = fmt(s.elevator, values);
      else if (e.distanceM <= AT_ENTRANCE_M)
        text = fmt(s.elevatorAt, { ...values, label: e.label });
      else text = fmt(s.elevatorNear, { ...values, label: e.label, d: roundMetres(e.distanceM) });
      break;
    }

    case 'fare_gate':
      text = step.direction === 'in' ? s.gateIn : step.direction === 'out' ? s.gateOut : s.gate;
      if (WIDE_GATE.has(profile)) notes.push(s.gateWide);
      break;

    case 'stairs':
    case 'escalator': {
      const same = step.kind === 'stairs' ? s.stairsSameFloor : s.escalatorSameFloor;
      const moving = step.kind === 'stairs' ? s.stairs : s.escalator;
      text =
        step.direction === 'unknown'
          ? same
          : fmt(moving, { floor: stepFloor(step.toPanel, t), dir: vertical(step.direction) });
      break;
    }
  }

  if (step.uncertainEdgeIds.length > 0) notes.push(s.uncertain);
  return { text, notes };
}

export interface FailureText {
  title: string;
  reason: string;
  notes: string[];
  alternatives: string[];
}

const BLOCKER_ORDER: BlockReason[] = [
  'stairs',
  'escalator',
  'slope_too_steep',
  'step_too_high',
  'outage',
];

/** Why there is no route, and what to try instead. Never empty. */
export function describeFailure(
  failure: NoRoute,
  alternatives: readonly AlternativeCode[],
  t: Dictionary,
): FailureText {
  const n = t.noRoute;
  const notes: string[] = [];
  if (failure.reason === 'blocked_by_profile') {
    const present = BLOCKER_ORDER.filter((b) => failure.blockers[b] > 0);
    if (present.length > 0) {
      notes.push(
        fmt(n.blockers, {
          list: present.map((b) => n.blockerNames[b]).join(n.listSeparator),
        }),
      );
    }
    if (failure.blockers.slope_too_steep > 0) notes.push(n.steepCoarse);
  }
  return {
    title: n.title,
    reason: n[failure.reason],
    notes,
    alternatives: alternatives.map((a) => n.alternatives[a]),
  };
}
