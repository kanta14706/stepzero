import { useEffect, useState } from 'react';
import { useI18n, fmt } from '../i18n';
import { stationHref } from '../router';
import { DataNotBuiltError, loadStationIndex } from './data';
import type { StationIndexEntry } from './types';

type State =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'ready'; stations: StationIndexEntry[] };

export function stationName(entry: Pick<StationIndexEntry, 'name'>, lang: string): string {
  return entry.name[lang] ?? entry.name['ja'] ?? '';
}

export function StationList() {
  const { t, lang } = useI18n();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    loadStationIndex().then(
      (index) => {
        if (!cancelled) setState({ status: 'ready', stations: index.stations });
      },
      (err: unknown) => {
        if (!cancelled)
          setState({ status: err instanceof DataNotBuiltError ? 'missing' : 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section aria-labelledby="stations-title">
      <h2 id="stations-title">{t.stationsTitle}</h2>
      <p>{t.stationsIntro}</p>
      {state.status === 'loading' && <p role="status">{t.loading}</p>}
      {state.status === 'missing' && <p>{t.dataNotBuilt}</p>}
      {state.status === 'error' && <p role="alert">{t.loadError}</p>}
      {state.status === 'ready' && (
        <ul className="station-list">
          {state.stations.map((s) => (
            <li key={s.id}>
              <a
                href={stationHref(s.id)}
                aria-label={fmt(t.openStation, { name: stationName(s, lang) })}
              >
                {stationName(s, lang)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
