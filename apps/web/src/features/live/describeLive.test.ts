import { describe, expect, it } from 'vitest';
import { dictionaries } from '../../i18n';
import type { Lang } from '../../i18n';
import { describeLive } from './describeLive';
import { ARR, DEP, epoch, legLive, ride } from './testing';

const leg = ride();
const name = (_id: string | null, fallback: string) => fallback;
const iso = (s: number) => new Date(s * 1000).toISOString();
const say = (l: Parameters<typeof describeLive>[0], lang: Lang = 'ja') =>
  describeLive(l, leg, dictionaries[lang], lang, name);

describe('describeLive', () => {
  it('says on time, in words', () => {
    const d = say(legLive({ arrDelayS: 20, depDelayS: 10 }));
    expect(d).toEqual({ tone: 'on_time', lines: ['定刻どおりに運行しています。'] });
  });

  it('says how late and the new times next to the timetable ones', () => {
    const d = say(
      legLive({
        depDelayS: 300,
        arrDelayS: 300,
        liveDeparture: iso(epoch(DEP) + 300),
        liveArrival: iso(epoch(ARR) + 300),
      }),
      'en',
    );
    expect(d.tone).toBe('late');
    expect(d.lines[0]).toBe('About 5 min late.');
    expect(d.lines[1]).toBe('Departs 09:05, arrives 09:25 (timetable: 09:00, 09:20)');
  });

  it('says early trains are early, and keeps to the arrival when there is no live departure', () => {
    const d = say(legLive({ arrDelayS: -180, liveArrival: iso(epoch(ARR) - 180) }), 'en');
    expect(d.tone).toBe('early');
    expect(d.lines).toEqual(['About 3 min early.', 'Arrives 09:17 (timetable: 09:20)']);
  });

  it('says cancelled, and skipped stops', () => {
    expect(say(legLive({ trip: 'canceled' })).tone).toBe('canceled');
    const d = say(legLive({ skippedAlight: true, arrDelayS: 0, depDelayS: 0 }), 'en');
    expect(d.lines[0]).toBe('This train does not stop at 421.');
  });

  it('never says on time when it does not know', () => {
    const states: Parameters<typeof describeLive>[0][] = [
      legLive({ feed: 'stale', ageSeconds: 400, trip: null }),
      legLive({ feed: 'unavailable', trip: null }),
      legLive({ feed: 'offline', trip: null }),
      legLive({ feed: 'not_configured', trip: null }),
      legLive({ feed: 'not_covered', trip: null }),
      legLive({ trip: 'no_data' }),
    ];
    for (const lang of ['ja', 'ja-easy', 'en', 'zh-Hant'] as const) {
      for (const s of states) {
        const d = say(s, lang);
        expect(d.tone, `${lang} ${s.feed}`).toBe('info');
        expect(d.lines.join(' '), `${lang} ${s.feed}`).not.toBe('');
        expect(d.lines.join(' ')).not.toContain(dictionaries[lang].live.onTime);
      }
    }
    expect(say(legLive({ feed: 'stale', ageSeconds: 400, trip: null }), 'en').lines[0]).toBe(
      'Live information has not updated for 7 min. Showing timetable times.',
    );
  });

  it('is quiet while checking, so the bar can say it once', () => {
    expect(say(legLive({ feed: 'loading', trip: null })).tone).toBe('loading');
  });
});
