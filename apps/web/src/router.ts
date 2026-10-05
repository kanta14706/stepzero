import { useEffect, useState } from 'react';

export type Route =
  | { page: 'home' }
  | { page: 'station'; id: string }
  /** `params` is the query string after `#/journey?` (features/journey/url.ts reads it). */
  | { page: 'journey'; params: string };

/** `#/station/421` opens a station, `#/journey?...` a journey; anything else is the home page. */
export function parseHash(hash: string): Route {
  const m = /^#\/station\/([\w-]+)$/.exec(hash);
  if (m?.[1]) return { page: 'station', id: m[1] };
  const j = /^#\/journey(?:\?(.*))?$/.exec(hash);
  if (j) return { page: 'journey', params: j[1] ?? '' };
  return { page: 'home' };
}

export function stationHref(id: string): string {
  return `#/station/${id}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash));
    };
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
    };
  }, []);
  return route;
}
