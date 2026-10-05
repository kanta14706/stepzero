import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { fmt, useI18n } from '../../i18n';
import type { Dictionary } from '../../i18n/ja';
import { nameIn } from '../station-view/describe';
import { searchPlaces } from './geocode';
import type { PlaceSearchResult } from './geocode';
import { searchStations } from './stations';
import type { Place, Station } from './types';

type PointPlace = Extract<Place, { kind: 'point' }>;

export function stationLabel(s: Station, t: Dictionary, lang: string): string {
  return fmt(t.journey.stationLabel, { name: nameIn(s.name, lang) });
}

export function placeLabel(p: Place, t: Dictionary, lang: string): string {
  if (p.kind === 'station') return stationLabel(p.station, t, lang);
  return fmt(p.source === 'address' ? t.journey.pointAddress : t.journey.pointPlace, {
    label: p.label,
  });
}

function stationOption(s: Station, t: Dictionary, lang: string): string {
  const lines = s.lines.map((l) => nameIn(l.name, lang)).join(t.journey.lineSeparator);
  return fmt(t.journey.stationOption, { name: nameIn(s.name, lang), lines });
}

type Search =
  | { status: 'idle' }
  | { status: 'searching'; query: string }
  | { status: 'done'; query: string; result: PlaceSearchResult }
  | { status: 'failed'; query: string };

/**
 * One end of the journey. Typing lists matching stations at once (from the local list); places
 * and addresses are searched only when asked, because that sends the text to outside services.
 * Every choice is a button, so it works the same with a keyboard, a switch or a screen reader.
 */
export function PlacePicker({
  field,
  value,
  onChange,
  stations,
  searchFetch,
}: {
  field: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
  stations: readonly Station[];
  /** Test hook for the address and place search. */
  searchFetch?: typeof fetch;
}) {
  const { t, lang } = useI18n();
  const j = t.journey;
  const uid = useId();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<Search>({ status: 'idle' });
  const changeRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusAfter = useRef<'change' | 'input' | null>(null);

  useEffect(() => {
    if (focusAfter.current === 'change') changeRef.current?.focus();
    if (focusAfter.current === 'input') inputRef.current?.focus();
    focusAfter.current = null;
  }, [value]);

  const matches = useMemo(() => searchStations(stations, query), [stations, query]);

  const choose = (place: Place) => {
    focusAfter.current = 'change';
    setQuery('');
    setSearch({ status: 'idle' });
    onChange(place);
  };

  const runSearch = () => {
    const q = query.trim();
    if (!q) return;
    setSearch({ status: 'searching', query: q });
    searchPlaces(
      q,
      lang === 'ja-easy' ? 'ja' : lang,
      searchFetch ? { fetch: searchFetch } : {},
    ).then(
      (result) => {
        setSearch((s) =>
          s.status === 'searching' && s.query === q ? { status: 'done', query: q, result } : s,
        );
      },
      () => {
        setSearch((s) =>
          s.status === 'searching' && s.query === q ? { status: 'failed', query: q } : s,
        );
      },
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter searches places instead of submitting the whole planner.
    if (e.key === 'Enter') {
      e.preventDefault();
      runSearch();
    }
  };

  if (value) {
    return (
      <div className="place-picker" role="group" aria-labelledby={`${uid}-legend`}>
        <p id={`${uid}-legend`} className="place-field">
          {fmt(j.chosen, { field, label: placeLabel(value, t, lang) })}
        </p>
        <button
          ref={changeRef}
          type="button"
          className="step-button"
          aria-label={fmt(j.changeLabel, { field })}
          onClick={() => {
            focusAfter.current = 'input';
            onChange(null);
          }}
        >
          {j.change}
        </button>
      </div>
    );
  }

  const status =
    search.status === 'searching'
      ? j.searchingPlaces
      : search.status === 'failed'
        ? j.placeSearchFailed
        : search.status === 'done'
          ? search.result.places.length === 0
            ? search.result.failed.length === 2
              ? j.placeSearchFailed
              : j.noPlaceResults
            : search.result.failed.length > 0
              ? j.placeSearchPartial
              : ''
          : '';

  return (
    <fieldset className="place-picker">
      <legend>{field}</legend>
      <div className="field">
        <label htmlFor={`${uid}-q`}>{j.fieldHint}</label>
        <input
          ref={inputRef}
          id={`${uid}-q`}
          type="search"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {query.trim() !== '' && (
        <div role="group" aria-label={fmt(j.stationMatches, { field })}>
          {matches.length === 0 ? (
            <p className="hint">{j.noStationMatch}</p>
          ) : (
            <ul className="place-options">
              {matches.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="step-button place-option"
                    onClick={() => {
                      choose({ kind: 'station', station: s });
                    }}
                  >
                    {stationOption(s, t, lang)}
                    {s.tier === 2 && <span className="tier-tag">{j.stationTier2}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <button
        type="button"
        className="step-button"
        aria-label={fmt(j.searchPlacesLabel, { field })}
        disabled={query.trim() === '' || search.status === 'searching'}
        onClick={runSearch}
      >
        {j.searchPlaces}
      </button>
      <p role="status" className="hint">
        {status}
      </p>
      {search.status === 'done' && search.result.places.length > 0 && (
        <div role="group" aria-label={fmt(j.placeResults, { field })}>
          <ul className="place-options">
            {search.result.places.map((p: PointPlace, i) => (
              <li key={`${p.source}-${i}`}>
                <button
                  type="button"
                  className="step-button place-option"
                  onClick={() => {
                    choose(p);
                  }}
                >
                  {placeLabel(p, t, lang)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="hint">{j.placeSearchNote}</p>
    </fieldset>
  );
}
