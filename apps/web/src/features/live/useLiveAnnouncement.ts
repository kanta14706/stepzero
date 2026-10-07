import { useState } from 'react';
import { fmt, useI18n } from '../../i18n';
import { delayMinutes, headlineDelayS } from './delay';
import type { JourneyLive } from './useLiveStatus';

/** Trains that are late by a minute or more, or cancelled. */
export function troubledCount(live: JourneyLive): number {
  let n = 0;
  for (const l of live.byLeg.values()) {
    if (l.trip === 'canceled') n++;
    else if (l.trip === 'live') {
      const d = headlineDelayS(l);
      if (d !== null && delayMinutes(d) > 0) n++;
    }
  }
  return n;
}

/**
 * The sentence for a screen-reader live region when the live picture changes: once, when the
 * number of troubled trains differs from the last answer, never on every 30-second refresh and
 * never for the first answer (the page already shows it).
 */
export function useLiveAnnouncement(live: JourneyLive, legsKey: string): string {
  const { t } = useI18n();
  const count = live.updatedAt === null ? null : troubledCount(live);
  const [seen, setSeen] = useState<{ key: string; count: number | null; text: string }>({
    key: legsKey,
    count: null,
    text: '',
  });
  if (seen.key !== legsKey) {
    setSeen({ key: legsKey, count: null, text: '' });
  } else if (count !== null && seen.count !== count) {
    setSeen({
      key: legsKey,
      count,
      text:
        seen.count === null
          ? ''
          : count > 0
            ? fmt(t.live.changed, { n: count })
            : t.live.changedNone,
    });
  }
  return seen.text;
}
