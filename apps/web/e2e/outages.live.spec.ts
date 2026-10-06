/// <reference lib="dom" />
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Two riders on the same station page. A reports the elevator on the route as broken; B's route
 * changes without reloading. Needs the local Supabase stack: run with `pnpm e2e:live`.
 */
const STATION_ID = '421'; // 大門: several elevators, so there is another way round
const STATION = `/?basemap=off#/station/${STATION_ID}`;
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ request }) => {
  const data = await request.get('/data/graphs/index.json');
  test.skip(!data.ok(), 'station data not built (run the importer, then pnpm sync-data)');
  // Start from a station with no reports. Only the tests hold this key.
  const url = process.env['VITE_SUPABASE_URL'] ?? '';
  const key = process.env['SUPABASE_SECRET_KEY'] ?? '';
  const res = await request.delete(`${url}/rest/v1/outage_reports?station_id=eq.${STATION_ID}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  expect(res.ok(), await res.text()).toBe(true);
});

async function openStation(page: Page): Promise<string[]> {
  await page.goto(STATION);
  await expect(page.locator('.outage-status')).toHaveAttribute('data-status', 'live');
  await expect(page.locator('ol.steps > li').first()).toBeVisible();
  return page.locator('ol.steps > li > span:first-child').allTextContents();
}

async function expectNoSeriousViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test("A reports the elevator on the route as broken and B's route changes", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const before = await openStation(a);
  expect(await openStation(b)).toEqual(before);
  await expect(b.locator('.outage-list')).toHaveCount(0);

  // A: two taps on the first elevator step.
  const step = a.locator('ol.steps > li[data-kind="elevator"]').first();
  await step.locator('.report-open').click();
  await expect(step.getByRole('group')).toBeVisible();
  await expectNoSeriousViolations(a);
  const sentAt = Date.now();
  await step.getByRole('button', { name: '使えない' }).click();
  await expect(a.locator('.report-feedback')).toContainText('「使えない」と報告しました');
  await expect(a.locator('.report-feedback')).toBeFocused();

  // B: re-routed, with a notice, and the elevator is in the station's outage list.
  await expect(b.locator('.rerouted')).toBeVisible({ timeout: 10_000 });
  const elapsed = Date.now() - sentAt;
  console.log(`B re-routed ${elapsed} ms after A's report`);
  expect(elapsed).toBeLessThan(5_000);
  const after = await b.locator('ol.steps > li > span:first-child').allTextContents();
  expect(after).not.toEqual(before);
  await expect(b.locator('.outage-list > li')).toHaveCount(1);
  await expect(b.locator('.outage-list > li')).toContainText('確認した人 1人');
  await expectNoSeriousViolations(b);

  // B confirms it; A sees the count go up.
  await b.getByRole('button', { name: 'まだ使えない' }).click();
  await expect(a.locator('.outage-list > li')).toContainText('確認した人 2人');

  // A says it works again: both routes go back to the first one.
  await a.getByRole('button', { name: '使えるようになった' }).click();
  await expect(a.locator('.report-feedback')).toContainText('「使える」と報告しました');
  await expect(b.locator('.outage-list > li')).toHaveCount(0);
  await expect(b.locator('ol.steps > li > span:first-child')).toHaveText(before);
});

test('a page opened after a report already avoids the elevator', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const before = await openStation(a);
  const step = a.locator('ol.steps > li[data-kind="elevator"]').first();
  await step.locator('.report-open').click();
  await step.getByRole('button', { name: '使えない' }).click();
  await expect(a.locator('.report-feedback')).toContainText('「使えない」と報告しました');

  const c = await (await browser.newContext()).newPage();
  const route = await openStation(c);
  expect(route).not.toEqual(before);
  await expect(c.locator('.outage-list > li')).toHaveCount(1);
  // Opened after the report, so nothing "changed": no notice.
  await expect(c.locator('.rerouted')).toHaveCount(0);
});

test('a report made offline is queued, used at once on that phone, and sent when back online', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await (await browser.newContext()).newPage();
  const before = await openStation(a);
  await openStation(b);

  // A loses the connection, then reports the elevator on the route.
  await ctxA.setOffline(true);
  await expect(a.getByText('オフラインです。')).toBeVisible();
  const step = a.locator('ol.steps > li[data-kind="elevator"]').first();
  await step.locator('.report-open').click();
  await step.getByRole('button', { name: '使えない' }).click();
  await expect(a.locator('.report-feedback')).toContainText('報告をこの端末に保存しました');

  // A's own route avoids it at once; the list says it is not sent yet.
  await expect(a.locator('ol.steps > li > span:first-child')).not.toHaveText(before);
  await expect(a.locator('.outage-list > li')).toContainText('未送信');
  await expectNoSeriousViolations(a);

  // B has heard nothing.
  await b.waitForTimeout(1_500);
  await expect(b.locator('.outage-list > li')).toHaveCount(0);

  // A is back online: the report is sent, B re-routes, A's copy becomes the real report.
  await ctxA.setOffline(false);
  await expect(b.locator('.rerouted')).toBeVisible({ timeout: 15_000 });
  await expect(b.locator('.outage-list > li')).toHaveCount(1);
  await expect(a.locator('.outage-list > li')).toContainText('確認した人 1人', { timeout: 15_000 });
  await expect(a.locator('.outage-list > li')).not.toContainText('未送信');
  expect(await a.evaluate(() => localStorage.getItem('stepzero.reportQueue'))).toBeNull();
});
