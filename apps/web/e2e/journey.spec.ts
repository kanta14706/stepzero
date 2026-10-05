/// <reference lib="dom" />
/// <reference types="node" />
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A full 大門 → 新宿 wheelchair journey (step 2.4). OTP's answer is the one recorded from the
 * real server (src/features/journey/fixtures, scripts/record-otp.mjs), so this runs without OTP;
 * e2e/journey.live.spec.ts runs the same trip against a live OTP. Needs the importer output.
 */
const FIXTURES = resolve(import.meta.dirname, '../src/features/journey/fixtures');
const recorded = (name: string): unknown =>
  (JSON.parse(readFileSync(resolve(FIXTURES, `${name}.json`), 'utf-8')) as { data: unknown }).data;
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.beforeEach(async ({ request }) => {
  const res = await request.get('/data/stations.json');
  test.skip(!res.ok(), 'station data not built (run the importer, then pnpm sync-data)');
});

/** Answers the planner's OTP requests with a recorded answer; no street walks. */
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

async function expectNoSeriousViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

async function pickStation(
  page: Page,
  field: string,
  query: string,
  option: RegExp,
): Promise<void> {
  const box = page.getByRole('group', { name: field, exact: true });
  await box.getByRole('searchbox').fill(query);
  await box.getByRole('button', { name: option }).click();
  await expect(page.getByRole('button', { name: `${field}を選び直す` })).toBeFocused();
}

test('大門 → 新宿, wheelchair: entrance, elevators, platform, train, exit', async ({ page }) => {
  const queries = await mockOtp(page, 'daimon-shinjuku');
  await page.goto('/?basemap=off#/');

  await pickStation(page, '出発地', '大門', /^大門駅（大江戸線）/);
  await pickStation(page, '目的地', '新宿', /^新宿駅（大江戸線）/);
  await expect(page.getByRole('radio', { name: '車いす' })).toBeChecked();
  await page.getByRole('radio', { name: '時刻を指定する' }).check();
  await page.getByLabel('出発時刻（日本時間）').fill('2026-10-07T08:50');
  await page.getByRole('button', { name: 'ルートを調べる' }).click();

  // The plan is in the URL, and the results take the focus.
  await expect(page).toHaveURL(
    /#\/journey\?from=station%3A421&to=station%3A428&profile=wheelchair&at=/,
  );
  const results = page.getByRole('heading', { name: 'ルートの候補' });
  await expect(results).toBeFocused();
  await expect(page.locator('.journey-option')).toHaveCount(3);
  await expect(page.locator('.journey-option').first()).toHaveAttribute('aria-pressed', 'true');
  expect(queries.some((q) => q.includes('query Plan'))).toBe(true);

  // One timeline: the 大門 station, the train, the 新宿 station.
  const items = page.locator('.timeline > li');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toHaveAttribute('data-role', 'access');
  await expect(items.nth(0).getByRole('heading')).toHaveText('大門駅：入口からホームへ');
  await expect(items.nth(1)).toHaveAttribute('data-segment', 'ride');
  await expect(items.nth(1).getByRole('heading')).toHaveText(/大江戸線\s+光が丘行き/);
  await expect(items.nth(1)).toContainText('大門 09:00発 → 新宿 09:16着');
  await expect(items.nth(1).locator('.ride-advice')).toContainText('新宿駅で降りてすぐ');
  await expect(items.nth(2)).toHaveAttribute('data-role', 'egress');
  await expect(items.nth(2).getByRole('heading')).toHaveText('新宿駅：ホームから出口へ');

  // Inside both stations: an entrance, elevators, the ticket gate, the platform; never stairs or
  // escalators for a wheelchair.
  const access = items.nth(0).locator('ol.steps > li');
  await expect(access.first()).toContainText('出発します');
  await expect(items.nth(0).locator('ol.steps > li[data-kind="elevator"]').first()).toBeVisible();
  await expect(items.nth(0).locator('ol.steps > li[data-kind="fare_gate"]')).toHaveCount(1);
  await expect(access.last()).toContainText('番線ホームに着きます');
  await expect(items.nth(2).locator('ol.steps > li[data-kind="elevator"]').first()).toBeVisible();
  await expect(
    page.locator('.timeline li[data-kind="stairs"], .timeline li[data-kind="escalator"]'),
  ).toHaveCount(0);

  await expectNoSeriousViolations(page);

  // Another option shows its own timeline.
  await page.locator('.journey-option').nth(1).click();
  await expect(page.getByRole('heading', { name: '候補2の道順' })).toBeVisible();
  await expect(items.nth(1)).toContainText('大門 09:04発');
});

test('a shared journey link opens with the form filled in and the plan shown', async ({ page }) => {
  await mockOtp(page, 'daimon-shinjuku');
  await page.goto(
    '/?basemap=off#/journey?from=station:421&to=station:428&profile=wheelchair&at=2026-10-07T08:50',
  );
  await expect(page.locator('.journey-option')).toHaveCount(3);
  await expect(page.getByText('出発地：大門駅')).toBeVisible();
  await expect(page.getByText('目的地：新宿駅')).toBeVisible();
});

test('says so when the train planner cannot be reached', async ({ page }) => {
  await page.route('**/otp/gtfs/v1', (route) =>
    route.fulfill({ status: 502, body: 'bad gateway' }),
  );
  await page.goto(
    '/?basemap=off#/journey?from=station:421&to=station:428&profile=wheelchair&at=2026-10-07T08:50',
  );
  await expect(page.getByRole('alert')).toContainText('電車の経路検索に接続できません');
});

test('a tier-1 station is named and marked as not checked', async ({ page }) => {
  await mockOtp(page, 'daimon-oshiage');
  await page.goto(
    '/?basemap=off#/journey?from=station:421&to=station:120&profile=wheelchair&at=2026-10-07T08:50',
  );
  await expect(page.locator('.journey-option').first()).toContainText(
    '段差のない経路を確認できていない駅があります',
  );
  await expect(page.locator('.timeline > li[data-role="egress"] .tier1-note')).toBeVisible();
  await expectNoSeriousViolations(page);
});
