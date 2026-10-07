import { fmt, useI18n } from '../../i18n';
import { reportTime } from '../report/ReportControls';
import type { JourneyLive } from './useLiveStatus';
import type { TransferRisk } from './transfers';

interface Props {
  live: JourneyLive;
  risks: readonly TransferRisk[];
  stationName: (id: string | null, fallback: string) => string;
  onReplan?: (() => void) | undefined;
}

/** Above the timeline: when the live data is from, changes it puts in doubt, and re-planning. */
export function LiveBar({ live, risks, stationName, onReplan }: Props) {
  const { t, lang } = useI18n();
  const s = t.live;
  if (!live.covered) return null;
  return (
    <div className="live-bar">
      <p className="hint" data-testid="live-updated">
        {live.updatedAt ? fmt(s.updated, { time: reportTime(live.updatedAt, lang) }) : s.checking}
      </p>
      {risks.map((r, i) => (
        <p key={i} className="notice-inline live-risk" data-reason={r.reason}>
          {fmt(r.reason === 'late' ? s.transferLate : s.transferCanceled, {
            station: stationName(r.stationId, ''),
          })}
        </p>
      ))}
      {onReplan && (
        <p>
          <button type="button" className="step-button" onClick={onReplan}>
            {s.replan}
          </button>
          <span className="step-note">{s.replanHint}</span>
        </p>
      )}
    </div>
  );
}
