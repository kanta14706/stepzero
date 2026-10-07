import { useI18n } from '../../i18n';
import type { RideLeg } from '../journey/types';
import { describeLive } from './describeLive';
import { pickText } from './delay';
import type { LegLive, LiveAlert } from './types';

interface Props {
  leg: RideLeg;
  live: LegLive | undefined;
  alerts: readonly LiveAlert[];
  stationName: (id: string | null, fallback: string) => string;
}

/** The live state of one train, and the operator's alerts that concern it. */
export function LiveLeg({ leg, live, alerts, stationName }: Props) {
  const { t, lang } = useI18n();
  if (!live) return null;
  const d = describeLive(live, leg, t, lang, stationName);
  // "Checking" is a moment, and the bar above says it once; do not repeat it on every train.
  const [first, ...rest] = d.lines;
  return (
    <>
      {d.tone !== 'loading' && first !== undefined && (
        <p className="live-line" data-tone={d.tone}>
          {first}
          {rest.map((line) => (
            <span key={line} className="step-note">
              {line}
            </span>
          ))}
        </p>
      )}
      {alerts.length > 0 && (
        <div className="live-alerts notice-inline">
          <h5>{t.live.alertsTitle}</h5>
          <ul>
            {alerts.map((a) => (
              <li key={a.id}>
                <strong>{pickText(a.header, lang)}</strong>
                {pickText(a.description, lang) && (
                  <span className="step-note">{pickText(a.description, lang)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
