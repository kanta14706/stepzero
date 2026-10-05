/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANGUAGES, dictionaries } from '../../i18n';
import { findRoute, indexGraph } from '../../routing/astar';
import { routeToSteps } from '../../routing/steps';
import type { BoardingPosition } from '../../routing/boarding';
import type { Step } from '../../routing/steps';
import type { NoRoute, StationGraph } from '../../routing/types';
import { describeFailure, describeStep, roundMetres, stepFloor } from './describe';

const { ja, en } = dictionaries;

const base = { legStart: 0, legEnd: 1, panel: -1, lengthM: 10, seconds: 10, uncertainEdgeIds: [] };
const walk = (extra: Partial<Extract<Step, { kind: 'walk' }>> = {}): Step => ({
  ...base,
  kind: 'walk',
  turn: null,
  target: null,
  toPanel: -1,
  ramps: { count: 0, lengthM: 0, maxSlopePct: null },
  movingWalkway: false,
  narrowestWidthM: null,
  ...extra,
});
const elevator = (extra: Partial<Extract<Step, { kind: 'elevator' }>> = {}): Step => ({
  ...base,
  kind: 'elevator',
  direction: 'down',
  fromLevel: 0,
  toLevel: -3,
  panel: 0,
  toPanel: -3,
  entrance: null,
  ...extra,
});

const boarding = (extra: Partial<BoardingPosition> = {}): BoardingPosition => ({
  part: 'front',
  fromFront: 0.1,
  confidence: 'clear',
  approximate: false,
  nextStop: { ja: '汐留', en: 'Shiodome' },
  prevStop: { ja: '赤羽橋', en: 'Akabanebashi' },
  terminating: null,
  ...extra,
});
const onPlatform = (kind: 'start' | 'arrive', b: BoardingPosition): Step => ({
  ...base,
  kind,
  place: { type: 'platform', nodeId: 'n', platformId: 'P', code: '3', boarding: b },
});

/** One of every kind of step and variant, to check that every language renders all of them. */
const EVERY_STEP: Step[] = [
  onPlatform('start', boarding()),
  onPlatform('start', boarding({ nextStop: null, terminating: 'all', part: 'back' })),
  onPlatform('arrive', boarding({ confidence: 'weak', approximate: true, part: 'middle' })),
  onPlatform('arrive', boarding({ nextStop: null, terminating: 'all' })),
  { ...base, kind: 'start', place: { type: 'entrance', nodeId: 'n', label: 'A1' } },
  { ...base, kind: 'start', place: { type: 'entrance', nodeId: 'n', label: null } },
  { ...base, kind: 'start', place: { type: 'street', nodeId: 'n' } },
  {
    ...base,
    kind: 'start',
    place: { type: 'platform', nodeId: 'n', platformId: 'P', code: '3', boarding: null },
  },
  {
    ...base,
    kind: 'start',
    place: { type: 'platform', nodeId: 'n', platformId: null, code: null, boarding: null },
  },
  { ...base, kind: 'start', place: { type: 'other', nodeId: 'n', kind: 'junction' } },
  walk(),
  walk({ target: 'fare_gate' }),
  walk({ turn: 'left' }),
  walk({ turn: 'u_turn', target: 'elevator', toPanel: -2 }),
  walk({ ramps: { count: 1, lengthM: 12, maxSlopePct: 8 }, movingWalkway: true }),
  walk({ ramps: { count: 1, lengthM: 12, maxSlopePct: 18 }, uncertainEdgeIds: ['e'] }),
  walk({ ramps: { count: 1, lengthM: 12, maxSlopePct: null } }),
  elevator(),
  elevator({ direction: 'up', toPanel: 0, entrance: { label: 'B5', distanceM: 0 } }),
  elevator({ entrance: { label: 'A1', distanceM: 14 } }),
  elevator({ direction: 'unknown', toPanel: 0 }),
  { ...base, kind: 'fare_gate', direction: 'in' },
  { ...base, kind: 'fare_gate', direction: 'out' },
  { ...base, kind: 'fare_gate', direction: 'unknown' },
  { ...base, kind: 'stairs', direction: 'down', toPanel: -2 },
  { ...base, kind: 'stairs', direction: 'unknown', toPanel: -1 },
  { ...base, kind: 'escalator', direction: 'up', toPanel: 0 },
  { ...base, kind: 'escalator', direction: 'unknown', toPanel: -1 },
  { ...base, kind: 'arrive', place: { type: 'entrance', nodeId: 'n', label: 'A1' } },
  { ...base, kind: 'arrive', place: { type: 'entrance', nodeId: 'n', label: null } },
  { ...base, kind: 'arrive', place: { type: 'street', nodeId: 'n' } },
  {
    ...base,
    kind: 'arrive',
    place: { type: 'platform', nodeId: 'n', platformId: 'P', code: '3', boarding: null },
  },
  { ...base, kind: 'arrive', place: { type: 'other', nodeId: 'n', kind: 'junction' } },
];

describe('roundMetres', () => {
  it.each([
    [0.2, 1],
    [4.4, 4],
    [9.6, 10],
    [12.4, 10],
    [13, 15],
    [106, 105],
  ])('%d m reads as %d m', (m, expected) => {
    expect(roundMetres(m)).toBe(expected);
  });
});

describe('stepFloor', () => {
  it('calls the ground street level and uses the floor names elsewhere', () => {
    expect(stepFloor(0, en)).toBe('street level');
    expect(stepFloor(-3, en)).toBe('B3');
    expect(stepFloor(-3, ja)).toBe('地下3階');
    expect(stepFloor(1, ja)).toBe('1階');
  });
});

describe('describeStep', () => {
  it.each(LANGUAGES)('%s: renders every kind of step with no leftover placeholders', (lang) => {
    for (const step of EVERY_STEP) {
      const { text, notes } = describeStep(step, dictionaries[lang], 'wheelchair', lang);
      for (const s of [text, ...notes]) {
        expect(s.trim(), JSON.stringify(step)).not.toBe('');
        expect(s, JSON.stringify(step)).not.toMatch(/[{}]|undefined|null|NaN/);
      }
    }
  });

  it('builds walk sentences from the turn, distance and target', () => {
    expect(describeStep(walk(), en, 'wheelchair', 'en').text).toBe('Go 10 m.');
    expect(describeStep(walk({ target: 'fare_gate' }), en, 'wheelchair', 'en').text).toBe(
      'Go 10 m to the ticket gates.',
    );
    expect(
      describeStep(walk({ turn: 'left', target: 'elevator' }), en, 'wheelchair', 'en').text,
    ).toBe('Turn left and go 10 m to the elevator.');
    expect(
      describeStep(walk({ turn: 'left', target: 'elevator' }), ja, 'wheelchair', 'ja').text,
    ).toBe('左に曲がり、エレベーターまで10m進みます。');
  });

  it('describes ramps from the slope bucket, and says when the slope is unknown', () => {
    const ramp = (maxSlopePct: number | null) =>
      describeStep(walk({ ramps: { count: 1, lengthM: 21, maxSlopePct } }), en, 'wheelchair', 'en')
        .notes;
    expect(ramp(8)).toEqual(['There is a slope on the way (20 m, up to 8%).']);
    expect(ramp(18)).toEqual(['There is a steep slope on the way (20 m, over 8%).']);
    expect(ramp(null)[0]).toMatch(/not in the data/);
    expect(ramp(0)).toEqual([]); // a ramp in the flat bucket is not worth a warning
  });

  it('says when a stretch has no slope or step data', () => {
    expect(describeStep(walk({ uncertainEdgeIds: ['x'] }), en, 'wheelchair', 'en').notes).toEqual([
      'Part of this stretch has no slope or step data. Please take care.',
    ]);
  });

  it('names an elevator by its entrance when it is at or near one, and by its floor otherwise', () => {
    const text = (e: Partial<Extract<Step, { kind: 'elevator' }>>) =>
      describeStep(elevator(e), en, 'wheelchair', 'en').text;
    expect(text({ entrance: { label: 'B5', distanceM: 0 } })).toBe(
      'Take the elevator at exit B5 down to B3.',
    );
    expect(text({ entrance: { label: 'E1', distanceM: 1 } })).toBe(
      'Take the elevator at exit E1 down to B3.',
    );
    expect(text({ entrance: { label: 'A1', distanceM: 14 } })).toBe(
      'Take the elevator about 15 m from exit A1 down to B3.',
    );
    expect(text({})).toBe('Take the elevator down to B3.');
    expect(text({ direction: 'up', toPanel: 0 })).toBe('Take the elevator up to street level.');
  });

  it('suggests the wide gate only to profiles that need it', () => {
    const gate: Step = { ...base, kind: 'fare_gate', direction: 'in' };
    expect(describeStep(gate, en, 'wheelchair', 'en').notes).toHaveLength(1);
    expect(describeStep(gate, en, 'stroller_luggage', 'en').notes).toHaveLength(1);
    expect(describeStep(gate, en, 'sensory', 'en').notes).toHaveLength(0);
  });
});

describe('boarding notes', () => {
  const notes = (step: Step, lang: 'ja' | 'en' = 'en') =>
    describeStep(step, dictionaries[lang], 'wheelchair', lang).notes;

  it('says where on the train you reach the platform, by the next station', () => {
    expect(notes(onPlatform('arrive', boarding()))).toEqual([
      'You reach the platform near the front of trains towards Shiodome.',
      'Car numbers are not in the data, so this says front, middle or back.',
    ]);
    expect(notes(onPlatform('arrive', boarding()), 'ja')[0]).toBe(
      'ホームに着く場所は、汐留方面行きの電車の前の方です。',
    );
  });

  it('says where to ride when the route starts on the platform', () => {
    expect(notes(onPlatform('start', boarding({ part: 'back' })), 'ja')[0]).toBe(
      '汐留方面行きの電車でこの駅に来るときは、後ろの方の車両に乗ると、降りてすぐこの道順を使えます。',
    );
    expect(notes(onPlatform('start', boarding({ nextStop: null, terminating: 'all' })))[0]).toBe(
      'Coming here on a train that ends here? Ride near the front to get off close to this route.',
    );
  });

  it('warns that nobody boards on a platform where every train ends', () => {
    expect(notes(onPlatform('arrive', boarding({ nextStop: null, terminating: 'all' })))).toEqual([
      'Every train on this platform ends here. Check which platform you need.',
    ]);
  });

  it('flags an estimated direction and an approximate position', () => {
    const n = notes(onPlatform('arrive', boarding({ confidence: 'weak', approximate: true })));
    expect(n).toHaveLength(4);
    expect(n[1]).toMatch(/estimated/);
    expect(n[2]).toMatch(/approximate/);
  });

  it('uses the Japanese station name when there is no translation', () => {
    const b = boarding({ nextStop: { ja: '汐留' } });
    expect(notes(onPlatform('arrive', b))[0]).toMatch(/towards 汐留/);
  });

  it('adds nothing when the data cannot tell the direction', () => {
    expect(
      notes({
        ...base,
        kind: 'arrive',
        place: { type: 'platform', nodeId: 'n', platformId: 'P', code: '3', boarding: null },
      }),
    ).toEqual([]);
  });
});

describe('describeFailure', () => {
  it('lists what is in the way and admits the slope data is coarse', () => {
    const f = describeFailure(
      {
        reason: 'blocked_by_profile',
        blockers: { stairs: 3, escalator: 0, slope_too_steep: 1, step_too_high: 0, outage: 0 },
      },
      ['try_another_entrance', 'ask_staff'],
      en,
    );
    expect(f.reason).toMatch(/no route/);
    expect(f.notes).toEqual([
      'In the way: stairs, steep slopes',
      'The data only says the slope is "over 8%", so it may still be passable. Please check with station staff.',
    ]);
    expect(f.alternatives).toEqual([
      'Choose another entrance',
      'Ask station staff for help (at the ticket gates or by intercom)',
    ]);
  });

  it.each(LANGUAGES)('%s: has text for every reason', (lang) => {
    const t = dictionaries[lang];
    for (const failure of [
      { reason: 'unknown_node', nodeIds: [] },
      { reason: 'disconnected' },
      { reason: 'blocked_by_outage', outageEdgeIds: ['e'] },
    ] satisfies NoRoute[]) {
      const f = describeFailure(failure, ['wait_for_repair'], t);
      expect(f.reason.trim()).not.toBe('');
      expect(f.alternatives).toHaveLength(1);
    }
  });
});

const GRAPHS = resolve(import.meta.dirname, '../../../../../data/build/graphs');

describe.skipIf(!existsSync(resolve(GRAPHS, '421.json')))(
  '大門 (421): wheelchair directions, exit to platform 3',
  () => {
    const g = JSON.parse(readFileSync(resolve(GRAPHS, '421.json'), 'utf-8')) as StationGraph;
    const idx = indexGraph(g);
    const route = findRoute(idx, {
      from: g.nodes.filter((n) => n.kind === 'entrance').map((n) => n.id),
      to: g.station.platforms.find((p) => p.id === '421P3')?.nodeIds ?? [],
      profile: 'wheelchair',
    });
    const steps = route.ok ? routeToSteps(idx, route) : [];
    const texts = (lang: 'ja' | 'en') =>
      steps.map((s) => describeStep(s, dictionaries[lang], 'wheelchair', lang).text);

    it('reads naturally in Japanese', () => {
      expect(texts('ja')).toEqual([
        'B5出入口から出発します。',
        'B5出入口のエレベーターで地下3階へ降ります。',
        '右ななめ前に9m進みます。',
        '右に曲がり、20m進みます。',
        '左に曲がり、9m進みます。',
        '右に曲がり、15m進みます。',
        '右ななめ前に改札まで10m進みます。',
        '改札を通って中に入ります。',
        '左に曲がり、20m進みます。',
        '左ななめ前にエレベーターまで9m進みます。',
        'エレベーターで地下5階へ降ります。',
        '左ななめ前にホームまで7m進みます。',
        '3番線ホームに着きます。',
      ]);
    });

    it('reads naturally in English', () => {
      const en = texts('en');
      expect(en[1]).toBe('Take the elevator at exit B5 down to B3.');
      expect(en[6]).toBe('Bear right and go 10 m to the ticket gates.');
      expect(en[en.length - 1]).toBe('You arrive on platform 3.');
    });
  },
);
