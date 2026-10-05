/// <reference lib="dom" />
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The 大門 → 新宿 wheelchair journey against a live OTP (`cd otp && docker compose up otp`) and
 * the local Supabase stack, through the preview server's /otp proxy. Run with `pnpm e2e:live`.
 * Skipped when OTP is not reachable.
 */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Next weekday at 09:00 in Tokyo, as the journey URL's "YYYY-MM-DDTHH:MM". */
function nextWeekdayMorning(): string {
  const tokyo = new Date(Date.now() + 9 * 3600_000);
  do tokyo.setUTCDate(tokyo.getUTCDate() + 1);
  while (tokyo.getUTCDay() === 0 || tokyo.getUTCDay() === 6);
  return `${tokyo.toISOString().slice(0, 10)}T09:00`;
}

const JOURNEY = `/?basemap=off#/journey?from=station:421&to=station:428&profile=wheelchair&at=${nextWeekdayMorning()}`;

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ request }) => {
  const otp = await request
    .post('/otp/gtfs/v1', { data: { query: '{ feeds { feedId } }' } })
    .catch(() => null);
  test.skip(!otp?.ok(), 'OTP is not running (cd otp && docker compose up otp)');
  const url = process.env['VITE_SUPABASE_URL'] ?? '';
  const key = process.env['SUPABASE_SECRET_KEY'] ?? '';
  const res = await request.delete(`${url}/rest/v1/outage_reports?station_id=in.(421,428)`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  expect(res.ok(), await res.text()).toBe(true);
});

async function openJourney(page: Page): Promise<string[]> {
  await page.goto(JOURNEY);
  await expect(page.locator('.journey-option')).not.toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.journey-results .outage-status')).toHaveAttribute(
    'data-status',
    'live',
  );
  return page
    .locator('.timeline > li[data-role="access"] ol.steps > li > span:first-child')
    .allTextContents();
}

test('the live journey: 大門 entrance to the 新宿 exit, step-free', async ({ page }) => {
  await openJourney(page);
  const items = page.locator('.timeline > li');
  await expect(items).toHaveCount(3);
  await expect(items.nth(1)).toContainText('大江戸線');
  await expect(
    page.locator('.timeline li[data-kind="stairs"], .timeline li[data-kind="escalator"]'),
  ).toHaveCount(0);
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad, JSON.stringify(results.violations, null, 2)).toEqual([]);
});

test("A reports the first elevator of the journey and B's journey changes", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const before = await openJourney(a);
  expect(await openJourney(b)).toEqual(before);

  const step = a
    .locator('.timeline > li[data-role="access"] ol.steps > li[data-kind="elevator"]')
    .first();
  await step.locator('.report-open').click();
  const sentAt = Date.now();
  await step.getByRole('button', { name: '使えない' }).click();
  await expect(a.locator('.report-feedback')).toContainText('「使えない」と報告しました');

  await expect(b.locator('.journey-results .rerouted')).toBeVisible({ timeout: 10_000 });
  console.log(`B's journey changed ${Date.now() - sentAt} ms after A's report`);
  const after = await b
    .locator('.timeline > li[data-role="access"] ol.steps > li > span:first-child')
    .allTextContents();
  expect(after).not.toEqual(before);
});
