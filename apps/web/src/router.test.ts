import { describe, expect, it } from 'vitest';
import { parseHash, stationHref } from './router';

describe('parseHash', () => {
  it('opens a station', () => {
    expect(parseHash('#/station/421')).toEqual({ page: 'station', id: '421' });
    expect(parseHash(stationHref('421'))).toEqual({ page: 'station', id: '421' });
  });
  it('falls back to home for anything else', () => {
    for (const h of ['', '#/', '#/station/', '#/station/a/b', '#/other']) {
      expect(parseHash(h)).toEqual({ page: 'home' });
    }
  });
});
