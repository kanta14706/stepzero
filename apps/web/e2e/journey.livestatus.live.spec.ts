/// <reference lib="dom" />
/// <reference types="node" />
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Live train status in the journey (step 2.7, D-027), in a browser.
 *
 * Most tests answer the `live-status` function with made-up feeds (and OTP with the recorded
 * answers), so every state can be checked: late, stale, down, a connection at risk. They are in
 * the live project only because the app needs the Supabase URL and key built in before it asks
 * the function at all; the local stack must be running (`supabase start && pnpm e2e:live`).
 *
 * The last test goes through the real thing: the browser, the local gateway, the edge function
 * (`supabase functions serve`) and Toei's real feed, with a live OTP. It skips itself when those
 * are not running, as the other live specs do.
 */
const FIXTURES = resolve(import.meta.dirname, '../src/features/journey/fixtures');
interface Leg {
  mode: string;
  trip: { gtfsId: string } | null;
  serviceDate: string | null;
  start: { scheduledTime: string };
  end: { scheduledTime: string };
  from: { stopPosition: { position?: number } | null };
  to: { stopPosition: { position?: number } | null };
}
interface Plan {
  planConnection: { edges: { node: { legs: Leg[] } }[] };
}
const recorded = (name: string): Plan =>
  (JSON.parse(readFileSync(resolve(FIXTURES, `${name}.json`), 'utf-8')) as { data: Plan }).data;

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const LANGS = ['ja', 'en', 'zh-Hant', 'ja-easy'] as const;
const JOURNEY =
  '/?basemap=off#/journey?from=station:421&to=station:428&profile=wheelchair&at=2026-10-07T08:50';
const WITH_CHANGE =
  '/?basemap=off#/journey?from=station:421&to=station:120&profile=wheelchair&at=2026-10-07T08:50';

test.beforeEach(async ({ request }) => {
  const res = await request.get('/data/stations.json');
  test.skip(!res.ok(), 'station data not built (run the importer, then pnpm sync-data)');
});

async function mockOtp(page: Page, plan: string): Promise<string[]> {
  const queries: string[] = [];
  await page.route('**/otp/gtfs/v1', async (route) => {
    const body = route.request().postDataJSON() as { query: string };
    queries.push(body.query);
    const data = body.query.includes('query Plan')
      ? recorded(plan)
      : { planConnection: { routingErrors: [], edges: [] } };
    await route.fulfill({ json: { data } });
  });
  return queries;
}

const epoch = (iso: string): number => Date.parse(iso) / 1000;

/** The function's answer for the requested trains of a recorded plan, `late(leg)` seconds late. */
function feedFor(plan: Plan, late: (leg: Leg, firstRide: boolean) => number | null, over = {}) {
  const trips: Record<string, unknown> = {};
  for (const { node } of plan.planConnection.edges) {
    const rides = node.legs.filter((l) => l.mode !== 'WALK' && l.trip);
    rides.forEach((leg, i) => {
      const s = late(leg, i === 0);
      const from = leg.from.stopPosition?.position;
      const to = leg.to.stopPosition?.position;
      if (s === null || !leg.trip || from === undefined || to === undefined) return;
      trips[leg.trip.gtfsId.split(':')[1]] = {
        startDate: (leg.serviceDate ?? '').replaceAll('-', ''),
        canceled: false,
        stops: [
          {
            seq: from,
            arrival: null,
            departure: epoch(leg.start.scheduledTime) + s,
            skipped: false,
          },
          { seq: to, arrival: epoch(leg.end.scheduledTime) + s, departure: null, skipped: false },
        ],
      };
    });
  }
  return {
    operator: 'toei',
    feedId: '1',
    status: 'ok',
    feedTimestamp: new Date().toISOString(),
    ageSeconds: 5,
    trips,
    tripCount: Object.keys(trips).length,
    alertsStatus: 'ok',
    alerts: [],
    ...over,
  };
}

async function mockLive(page: Page, answer: (route: Route) => Promise<void> | void): Promise<void> {
  await page.route('**/functions/v1/live-status*', answer);
}

async function expectNoSeriousViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

const ride = (page: Page) => page.locator('.timeline > li[data-segment="ride"]').first();

test('a late train shows how late, the new times and the timetable ones', async ({ page }) => {
  await mockOtp(page, 'daimon-shinjuku');
  const asked: string[] = [];
  await mockLive(page, (route) => {
    asked.push(route.request().url());
    return route.fulfill({ json: feedFor(recorded('daimon-shinjuku'), () => 300) });
  });
  await page.goto(JOURNEY);

  await expect(ride(page)).toContainText('約5分遅れています。');
  await expect(ride(page)).toContainText('出発 09:05、到着 09:21（時刻表：09:00、09:16）');
  await expect(page.getByTestId('live-updated')).toContainText('に更新');
  expect(asked[0]).toContain('operator=toei');
  expect(asked[0]).toMatch(/trips=[0-9A-Z]+/);
});

test('on time is said only when the feed says so, and a missing train is not "on time"', async ({
  page,
}) => {
  await mockOtp(page, 'daimon-shinjuku');
  await mockLive(page, (route) =>
    route.fulfill({ json: feedFor(recorded('daimon-shinjuku'), () => null) }),
  );
  await page.goto(JOURNEY);
  await expect(ride(page)).toContainText('この列車のリアルタイム情報はまだありません');
  await expect(ride(page)).not.toContainText('定刻どおり');
});

test('a feed that stopped updating is said to be old, and not shown as fact', async ({ page }) => {
  await mockOtp(page, 'daimon-shinjuku');
  await mockLive(page, (route) =>
    route.fulfill({
      json: feedFor(recorded('daimon-shinjuku'), () => 0, { status: 'stale', ageSeconds: 420 }),
    }),
  );
  await page.goto(JOURNEY);
  await expect(ride(page)).toContainText('リアルタイム情報が7分前から更新されていません');
  await expect(ride(page)).not.toContainText('定刻どおり');
  await expect(ride(page)).toContainText('09:00発 → 新宿 09:16着'); // the timetable stays
});

test('when the live service is down, the journey is still there and says why', async ({ page }) => {
  await mockOtp(page, 'daimon-shinjuku');
  await mockLive(page, (route) => route.fulfill({ status: 502, json: { status: 'unavailable' } }));
  await page.goto(JOURNEY);
  await expect(ride(page)).toContainText('リアルタイム情報を取得できません');
  await expect(page.locator('.journey-option')).not.toHaveCount(0);
});

test('a delay that breaks a connection is warned about, and one button plans again from now', async ({
  page,
}) => {
  const queries = await mockOtp(page, 'daimon-oshiage');
  // only the first train of each itinerary is late; the second has no live data yet
  await mockLive(page, (route) =>
    route.fulfill({
      json: feedFor(recorded('daimon-oshiage'), (_leg, first) => (first ? 1200 : null)),
    }),
  );
  await page.goto(WITH_CHANGE);
  await expect(page.locator('.live-risk')).toContainText('乗り換えに間に合わないおそれがあります');

  await page.getByRole('button', { name: '今の時刻で探し直す' }).click();
  await expect(page).not.toHaveURL(/at=/);
  await expect
    .poll(() => queries.filter((q) => q.includes('query Plan')).length)
    .toBeGreaterThan(1);
});

for (const lang of LANGS) {
  test(`axe: a journey with a late train and an alert, ${lang}`, async ({ page }) => {
    await mockOtp(page, 'daimon-shinjuku');
    await mockLive(page, (route) =>
      route.fulfill({
        json: feedFor(recorded('daimon-shinjuku'), () => 300, {
          alerts: [
            {
              id: 'a1',
              cause: 'TECHNICAL_PROBLEM',
              effect: 'SIGNIFICANT_DELAYS',
              header: [
                { language: 'ja', text: '信号トラブル' },
                { language: 'en', text: 'Signal trouble' },
              ],
              description: [{ language: 'ja', text: '一部の列車に遅れが出ています。' }],
              routeIds: [],
              tripIds: [],
              stopIds: [],
              periods: [],
            },
          ],
        }),
      }),
    );
    await page.goto(JOURNEY);
    await page.locator('#language-select').selectOption(lang);
    await expect(page.locator('.live-line').first()).toBeVisible();
    await expect(page.locator('.live-alerts')).toBeVisible();
    await expectNoSeriousViolations(page);
  });
}

test('axe: stale and unavailable states, high contrast', async ({ page }) => {
  await page.emulateMedia({ contrast: 'more', colorScheme: 'dark' });
  await mockOtp(page, 'daimon-shinjuku');
  await mockLive(page, (route) =>
    route.fulfill({
      json: feedFor(recorded('daimon-shinjuku'), () => 0, { status: 'stale', ageSeconds: 420 }),
    }),
  );
  await page.goto(JOURNEY);
  await expect(page.locator('.live-line').first()).toBeVisible();
  await expectNoSeriousViolations(page);
});

test('the live button is a 44 px target and has a visible focus ring', async ({ page }) => {
  await mockOtp(page, 'daimon-shinjuku');
  await mockLive(page, (route) =>
    route.fulfill({ json: feedFor(recorded('daimon-shinjuku'), () => 0) }),
  );
  await page.goto(JOURNEY);
  const button = page.getByRole('button', { name: '今の時刻で探し直す' });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await button.focus();
  await expect(button).toBeFocused();
  const outline = await button.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
});

test('through the real function and Toei feed: a running train has live information', async ({
  page,
  request,
}) => {
  const url = process.env['VITE_SUPABASE_URL'] ?? '';
  const key = process.env['VITE_SUPABASE_PUBLISHABLE_KEY'] ?? '';
  const fn = await request
    .get(`${url}/functions/v1/live-status?operator=toei&trips=x`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    .catch(() => null);
  test.skip(
    !fn?.ok(),
    'the live-status function is not running (supabase functions serve --env-file .env)',
  );
  const otp = await request
    .post('/otp/gtfs/v1', { data: { query: '{ feeds { feedId } }' } })
    .catch(() => null);
  test.skip(!otp?.ok(), 'OTP is not running (cd otp && docker compose up otp)');

  // Leaving now: the first train is one that is running, so it is in the feed.
  await page.goto('/?basemap=off#/journey?from=station:421&to=station:428&profile=wheelchair');
  const planned = page.locator('.journey-option').first();
  const noService = page.locator('.journey-results [role="alert"]');
  await expect(planned.or(noService)).toBeVisible({ timeout: 30_000 });
  test.skip(await noService.isVisible(), 'no trains now (the Ōedo Line is not running)');

  const line = ride(page).locator('.live-line');
  await expect(line).toBeVisible({ timeout: 30_000 });
  const text = (await line.textContent()) ?? '';
  test.info().annotations.push({ type: 'live line', description: text });
  // Any of these means the whole chain worked. A failure of the chain says "cannot be fetched",
  // "not available in this setup" or "has not updated".
  expect(text).toMatch(/定刻どおり|遅れています|早く走っています|まだありません/);
});
