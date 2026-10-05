import { useI18n } from '../i18n';
import type { FloorSummary } from './floors';

/** The same content as the map, as text (every map interaction needs a text equivalent). */
export function FloorSummaryList({ summary }: { summary: FloorSummary }) {
  const { t } = useI18n();
  const count = (n: number) => (n === 0 ? t.rowNone : String(n));
  const entrances =
    summary.entrances.length === 0
      ? t.rowNone
      : summary.entrances.map((e) => e ?? t.unnamed).join(', ');
  const platforms =
    summary.platforms.length === 0
      ? t.rowNone
      : summary.platforms.map((p) => `${p.code ?? p.id} (${p.areas})`).join(', ');
  const rows: [string, string][] = [
    [t.rowEntrances, entrances],
    [t.rowGates, count(summary.gates)],
    [t.rowPlatforms, platforms],
    [t.rowElevators, count(summary.elevators)],
    [t.rowEscalators, count(summary.escalators)],
    [t.rowStairs, count(summary.stairs)],
    [t.rowRamps, count(summary.ramps)],
    [t.rowToilets, summary.toilets === null ? t.rowUnknown : count(summary.toilets)],
  ];
  return (
    <section aria-labelledby="floor-list-title" className="floor-list">
      <h2 id="floor-list-title">{t.listTitle}</h2>
      <p>{t.listIntro}</p>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label} className="floor-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
