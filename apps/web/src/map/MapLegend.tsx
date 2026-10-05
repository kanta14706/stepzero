import { useI18n } from '../i18n';

export function MapLegend({ showRoute = false }: { showRoute?: boolean }) {
  const { t } = useI18n();
  const items: [string, string][] = [
    ['elevator', t.legendElevator],
    ['escalator', t.legendEscalator],
    ['stairs', t.legendStairs],
    ['walk', t.legendWalk],
    ...(showRoute ? ([['route', t.legendRoute]] as [string, string][]) : []),
  ];
  return (
    <section aria-labelledby="legend-title" className="legend">
      <h2 id="legend-title">{t.legendTitle}</h2>
      <ul>
        {items.map(([kind, text]) => (
          <li key={kind}>
            <span className={`swatch swatch-${kind}`} aria-hidden="true" />
            {text}
          </li>
        ))}
      </ul>
    </section>
  );
}
