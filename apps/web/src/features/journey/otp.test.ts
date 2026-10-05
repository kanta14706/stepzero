/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PLAN_QUERY, PlanError, otpUrl, parsePlan, planTrains, planWalk, stripFeed } from './otp';
import type { Place } from './types';

const recorded = (name: string) =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures', `${name}.json`), 'utf-8')) as {
    variables: Record<string, unknown>;
    data: Parameters<typeof parsePlan>[0];
  };

const DAIMON: Place = {
  kind: 'station',
  station: { id: '421', otpId: '1:421', name: { ja: '大門' }, lat: 0, lon: 0, lines: [], tier: 2 },
};
const SHINJUKU: Place = {
  kind: 'station',
  station: { id: '428', otpId: '1:428', name: { ja: '新宿' }, lat: 0, lon: 0, lines: [], tier: 2 },
};

function respond(body: unknown, ok = true): typeof fetch {
  return vi.fn(() =>
    Promise.resolve({ ok, status: ok ? 200 : 502, json: () => Promise.resolve(body) } as Response),
  );
}

describe('parsePlan', () => {
  it('turns a recorded answer into rides with stop, platform and station ids', () => {
    const [first] = parsePlan(recorded('daimon-shinjuku').data);
    expect(first?.legs).toHaveLength(1);
    const ride = first?.legs[0];
    expect(ride).toMatchObject({
      kind: 'ride',
      route: { id: '1:4', name: '大江戸線', color: '#CF3366' },
      headsign: '光が丘',
      from: { stopId: '421P4', stationId: '421', platformCode: '4' },
      to: { stopId: '428P7', stationId: '428' },
      departure: '2026-10-07T09:00:00+09:00',
    });
    expect(ride?.kind === 'ride' && ride.stops).toBeGreaterThan(3);
  });

  it('keeps walks between stops at a change, and stops without a parent are their own station', () => {
    const [first] = parsePlan(recorded('daimon-oshiage').data);
    const walk = first?.legs.find((l) => l.kind === 'walk');
    expect(walk).toMatchObject({ from: { stationId: '412' }, to: { stationId: '117' } });
  });

  it('says why when there are no trains', () => {
    const empty = (code: string) => ({ planConnection: { routingErrors: [{ code }], edges: [] } });
    expect(() => parsePlan(empty('OUTSIDE_SERVICE_PERIOD'))).toThrow(
      new PlanError('outside_service_period'),
    );
    expect(() => parsePlan(empty('LOCATION_NOT_FOUND'))).toThrow(
      new PlanError('location_not_found'),
    );
    expect(() => parsePlan(empty('SOMETHING_NEW'))).toThrow(new PlanError('no_trains'));
  });
});

describe('planTrains', () => {
  it('sends the recorded query: station ids, wheelchair for step-free profiles, transit only', async () => {
    const f = respond({ data: recorded('daimon-shinjuku').data });
    await planTrains(
      { from: DAIMON, to: SHINJUKU, time: '2026-10-07T09:00:00+09:00', profile: 'wheelchair' },
      { fetch: f, url: '/otp' },
    );
    const [url, init] =
      (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0] ?? [];
    expect(url).toBe('/otp');
    const body = JSON.parse(init?.body as string) as {
      query: string;
      variables: Record<string, unknown>;
    };
    expect(body.query).toBe(PLAN_QUERY);
    expect(body.query).toContain('transitOnly: true');
    expect(body.variables).toEqual(recorded('daimon-shinjuku').variables);
  });

  it('only the step-free profiles ask OTP for wheelchair access', async () => {
    const f = respond({ data: recorded('daimon-shinjuku').data });
    await planTrains({ from: DAIMON, to: SHINJUKU, time: 't', profile: 'sensory' }, { fetch: f });
    const init = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]?.[1];
    expect(
      (JSON.parse(init?.body as string) as { variables: { wheelchair: boolean } }).variables
        .wheelchair,
    ).toBe(false);
  });

  it('is "unavailable" when OTP cannot be reached or answers badly', async () => {
    const down = vi.fn(() =>
      Promise.reject(new TypeError('Failed to fetch')),
    ) as unknown as typeof fetch;
    const input = { from: DAIMON, to: SHINJUKU, time: 't', profile: 'wheelchair' as const };
    await expect(planTrains(input, { fetch: down })).rejects.toThrow(new PlanError('unavailable'));
    await expect(planTrains(input, { fetch: respond({}, false) })).rejects.toThrow(
      new PlanError('unavailable'),
    );
    await expect(planTrains(input, { fetch: respond({ errors: [{}] }) })).rejects.toThrow(
      new PlanError('unavailable'),
    );
  });
});

describe('planWalk', () => {
  it('sums the walk and returns null when OTP finds none', async () => {
    const ok = respond({
      data: {
        planConnection: {
          routingErrors: [],
          edges: [{ node: { duration: 600, legs: [{ distance: 500 }, { distance: 200 }] } }],
        },
      },
    });
    expect(
      await planWalk({ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, 't', 'wheelchair', { fetch: ok }),
    ).toEqual({ distanceM: 700, seconds: 600 });
    const none = respond({
      data: { planConnection: { routingErrors: [{ code: 'NO_ROUTE' }], edges: [] } },
    });
    expect(
      await planWalk({ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, 't', 'wheelchair', { fetch: none }),
    ).toBeNull();
  });
});

it('otpUrl uses VITE_OTP_URL, otherwise /otp on the app origin', () => {
  expect(otpUrl({ VITE_OTP_URL: 'https://otp.example/otp/gtfs/v1' })).toBe(
    'https://otp.example/otp/gtfs/v1',
  );
  expect(otpUrl({ BASE_URL: '/' })).toBe('/otp/gtfs/v1');
  expect(otpUrl({ BASE_URL: '/app/' })).toBe('/app/otp/gtfs/v1');
  expect(stripFeed('1:421P4')).toBe('421P4');
});
