import { describe, expect, it } from 'vitest';
import {
  alertActive,
  alertConcerns,
  alertsFor,
  computeLegLive,
  delayMinutes,
  headlineDelayS,
  pickText,
} from './delay';
import { ARR, DEP, alert, epoch, lateTrip, response, ride, stopTime, trip } from './testing';

describe('computeLegLive', () => {
  it('is the live time minus the timetable time, at the boarding and the alighting stop', () => {
    const l = computeLegLive(ride(), 'ok', response({ T1: lateTrip(300) }));
    expect(l.trip).toBe('live');
    expect(l.depDelayS).toBe(300);
    expect(l.arrDelayS).toBe(300);
    expect(l.liveDeparture).toBe('2026-10-07T00:05:00.000Z');
    expect(l.liveArrival).toBe('2026-10-07T00:25:00.000Z');
    expect(delayMinutes(headlineDelayS(l) ?? 0)).toBe(5);
  });

  it('counts under a minute as on time, early as negative', () => {
    expect(delayMinutes(59)).toBe(0);
    expect(delayMinutes(-59)).toBe(0);
    expect(delayMinutes(60)).toBe(1);
    expect(delayMinutes(-130)).toBe(-2);
  });

  it('uses the arrival at the stop you get off at, and the departure when it has none', () => {
    const l = computeLegLive(
      ride(),
      'ok',
      response({
        T1: trip([
          stopTime(3, { arrival: epoch(DEP) + 120 }),
          stopTime(9, { departure: epoch(ARR) + 60 }),
        ]),
      }),
    );
    expect([l.depDelayS, l.arrDelayS]).toEqual([120, 60]);
  });

  it('still gives the arrival delay when the boarding stop is already behind the train', () => {
    const l = computeLegLive(
      ride(),
      'ok',
      response({ T1: trip([stopTime(9, { arrival: epoch(ARR) + 180 })]) }),
    );
    expect(l.trip).toBe('live');
    expect(l.depDelayS).toBeNull();
    expect(l.arrDelayS).toBe(180);
  });

  it('says no data when the feed does not have the train, or has it for another day', () => {
    expect(computeLegLive(ride(), 'ok', response({})).trip).toBe('no_data');
    expect(
      computeLegLive(ride(), 'ok', response({ T1: { ...lateTrip(0), startDate: '20261008' } }))
        .trip,
    ).toBe('no_data');
    expect(computeLegLive(ride(), 'ok', response({ T1: trip([stopTime(4)]) })).trip).toBe(
      'no_data',
    );
  });

  it('marks a cancelled train and skipped stops', () => {
    expect(computeLegLive(ride(), 'ok', response({ T1: trip([], { canceled: true }) })).trip).toBe(
      'canceled',
    );
    const l = computeLegLive(
      ride(),
      'ok',
      response({
        T1: trip([stopTime(3, { skipped: true }), stopTime(9, { arrival: epoch(ARR) })]),
      }),
    );
    expect(l.skippedBoard).toBe(true);
    expect(l.skippedAlight).toBe(false);
  });

  it('makes no claim from stale data, an unavailable feed, or a train OTP gave no key for', () => {
    const resp = response({ T1: lateTrip(0) }, { status: 'stale', ageSeconds: 400 });
    const stale = computeLegLive(ride(), 'stale', resp);
    expect([stale.feed, stale.trip, stale.arrDelayS, stale.ageSeconds]).toEqual([
      'stale',
      null,
      null,
      400,
    ]);
    expect(computeLegLive(ride(), 'unavailable', null).trip).toBeNull();
    expect(
      computeLegLive(ride({ live: null }), 'ok', response({ T1: lateTrip(0) })).trip,
    ).toBeNull();
    // plans saved before step 2.7 have no `live` field at all
    const withoutLive = ride();
    delete withoutLive.live;
    expect(computeLegLive(withoutLive, 'ok', response({})).trip).toBeNull();
  });
});

describe('alerts', () => {
  const NOW = epoch(DEP);

  it('are active inside a period, or when they have none', () => {
    expect(alertActive(alert(), NOW)).toBe(true);
    expect(alertActive(alert({ periods: [{ start: NOW - 10, end: NOW + 10 }] }), NOW)).toBe(true);
    expect(alertActive(alert({ periods: [{ start: NOW + 10, end: null }] }), NOW)).toBe(false);
    expect(alertActive(alert({ periods: [{ start: null, end: NOW - 10 }] }), NOW)).toBe(false);
  });

  it('concern a leg by route (feed prefix removed), trip or stop, or the whole operator', () => {
    const leg = ride();
    expect(alertConcerns(alert(), leg)).toBe(true);
    expect(alertConcerns(alert({ routeIds: ['4'] }), leg)).toBe(true);
    expect(alertConcerns(alert({ routeIds: ['1'] }), leg)).toBe(false);
    expect(alertConcerns(alert({ tripIds: ['T1'] }), leg)).toBe(true);
    expect(alertConcerns(alert({ stopIds: ['428P1'] }), leg)).toBe(true);
    expect(alertConcerns(alert({ stopIds: ['999'] }), leg)).toBe(false);
  });

  it('are filtered for a leg by both', () => {
    const list = [
      alert({ id: 'now', routeIds: ['4'] }),
      alert({ id: 'later', routeIds: ['4'], periods: [{ start: NOW + 3600, end: null }] }),
      alert({ id: 'other', routeIds: ['9'] }),
    ];
    expect(alertsFor(ride(), list, NOW).map((a) => a.id)).toEqual(['now']);
  });

  it('are worded in the page language, falling back to English, then to anything', () => {
    const texts = [
      { language: 'ja', text: '遅延' },
      { language: 'en', text: 'Delays' },
    ];
    expect(pickText(texts, 'ja')).toBe('遅延');
    expect(pickText(texts, 'ja-easy')).toBe('遅延');
    expect(pickText(texts, 'en')).toBe('Delays');
    expect(pickText(texts, 'zh-Hant')).toBe('Delays');
    expect(pickText([{ language: 'ko', text: '지연' }], 'en')).toBe('지연');
    expect(pickText([], 'en')).toBe('');
  });
});
