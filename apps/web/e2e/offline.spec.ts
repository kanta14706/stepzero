/// <reference lib="dom" />
/// <reference types="node" />
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Offline (step 2.9, D-025): once the service worker is installed, the app, every station's
 * route and the last planned journey work with the network cut. Needs the importer output.
 */
const FIXTURES = resolve(import.meta.dirname, '../src/features/journey/fixtures');
const recorded = (name: string): unknown =>
  (JSON.parse(readFileSync(resolve(FIXTURES, `${name}.json`), 'utf-8')) as { data: unknown }).data;
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const OFFLINE = 'オフラインです。';

test.beforeEach(async ({ request }) => {
  const res = await request.get('/data/stations.json');
  test.skip(!res.ok(), 'station data not built (run the importer, then pnpm sync-data)');
});

/** Opens the app and waits until the service worker has precached it and controls the page. */
async function install(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

async function expectNoSeriousViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test('a station never opened before routes offline', async ({ page, context }) => {
  await install(page, '/?basemap=off#/');
  await expect(page.getByText(OFFLINE)).toHaveCount(0);

  await context.setOffline(true);
  await expect(page.getByText(OFFLINE)).toBeVisible();
  await page.goto('/?basemap=off#/station/425');
  await expect(page.getByRole('heading', { level: 2, name: /青山一丁目/ })).toBeVisible();
  const steps = page.locator('ol.steps > li');
  await expect(steps.first()).toBeVisible();
  expect(await steps.count()).toBeGreaterThan(3);
  await expect(page.getByText(OFFLINE)).toBeVisible();
  await expectNoSeriousViolations(page);
});

test('the last journey is shown offline, and reached from the home page', async ({
  page,
  context,
}) => {
  await page.route('**/otp/gtfs/v1', async (route) => {
    const body = route.request().postDataJSON() as { query: string };
    const data = body.query.includes('query Plan')
      ? recorded('daimon-shinjuku')
      : { planConnection: { routingErrors: [], edges: [] } };
    await route.fulfill({ json: { data } });
  });
  await install(page, '/?basemap=off#/');
  await page.goto(
    '/?basemap=off#/journey?from=station:421&to=station:428&profile=wheelchair&at=2026-10-07T08:50',
  );
  await expect(page.getByRole('heading', { name: 'ルートの候補' })).toBeVisible();
  const timeline = page.locator('.timeline > li');
  await expect(timeline).toHaveCount(3);
  const online = await page.locator('.journey-timeline').innerText();
  await page.waitForFunction(() => localStorage.getItem('stepzero.lastJourney') !== null);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'ルートの候補' })).toBeVisible();
  await expect(page.locator('.saved-plan')).toContainText('08:50出発の条件');
  await expect(timeline).toHaveCount(3);
  // The same journey, step for step.
  expect(await page.locator('.journey-timeline').innerText()).toBe(online);
  await expectNoSeriousViolations(page);

  // From the home page, the offline notice leads back to it.
  await page.goto('/?basemap=off#/');
  await page.getByRole('link', { name: '最後に調べたルートを開く' }).click();
  await expect(page.locator('.saved-plan')).toBeVisible();
  await expect(timeline).toHaveCount(3);
});

test('offline with no saved journey, the planner says why', async ({ page, context }) => {
  await install(page, '/?basemap=off#/');
  await context.setOffline(true);
  await page.goto('/?basemap=off#/journey?from=station:421&to=station:428&profile=wheelchair');
  await expect(page.getByRole('alert')).toContainText('この端末に保存されたルートもありません');
});
