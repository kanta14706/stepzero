import { useEffect, useState } from 'react';

export type Route = { page: 'home' } | { page: 'station'; id: string };

/** `#/station/421` opens a station; anything else is the home page. */
export function parseHash(hash: string): Route {
  const m = /^#\/station\/([\w-]+)$/.exec(hash);
  return m?.[1] ? { page: 'station', id: m[1] } : { page: 'home' };
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
