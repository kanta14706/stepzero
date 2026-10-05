import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** These tests need the importer output copied into public/data (`pnpm sync-data`). */
test.beforeEach(async ({ request }) => {
  const res = await request.get('/data/graphs/index.json');
  test.skip(!res.ok(), 'station data not built (run the importer, then pnpm sync-data)');
});

const STATION = '/?basemap=off#/station/421';

test('lists the Ōedo stations on the home page and opens one', async ({ page }) => {
  await page.goto('/');
  const links = page.locator('.station-list a');
  await expect(links).toHaveCount(12);
  await page.getByRole('link', { name: /大門/ }).click();
  await expect(page).toHaveURL(/#\/station\/421$/);
  await expect(page.getByRole('heading', { level: 2, name: /大門/ })).toBeVisible();
});

test('shows a rendered map, a floor switcher and a text list for the floor', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(STATION);
  const map = page.getByRole('region', { name: /駅構内マップ/ });
  await expect(map).toBeVisible();
  await expect(map.locator('canvas')).toBeVisible();
  await expect(page.getByRole('group', { name: '階を選ぶ' })).toBeVisible();
  // B1 is the first floor with map data
  await expect(page.getByRole('radio', { name: '地下1階' })).toBeChecked();
  await expect(page.getByRole('heading', { name: 'この階にあるもの' })).toBeVisible();
  await expect(page.locator('.floor-list').getByText('出入口', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('floor switcher works with the keyboard and updates the text list and status', async ({
  page,
}) => {
  await page.goto(STATION);
  const b1 = page.getByRole('radio', { name: '地下1階' });
  await b1.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: '地下2階' })).toBeChecked();
  await expect(page.getByRole('status').filter({ hasText: '地下2階を表示' })).toBeVisible();
  // the ground has no map polygons: the page says so and the toilet row is unknown
  await page.getByRole('radio', { name: '地上' }).check();
  await expect(page.getByText('この階には駅構内図のデータがありません')).toBeVisible();
  await expect(page.getByText(/不明（この階の構内図データがありません）/)).toBeVisible();
});

test('is usable in English', async ({ page }) => {
  await page.goto(STATION);
  await page.locator('#language-select').selectOption('en');
  await expect(page.getByRole('group', { name: 'Choose a floor' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'B1' })).toBeChecked();
  await expect(page.getByRole('heading', { name: 'What is on this floor' })).toBeVisible();
});

test('station page has no serious axe violations', async ({ page }) => {
  await page.goto(STATION);
  await expect(page.getByRole('region', { name: /駅構内マップ/ }).locator('canvas')).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad, JSON.stringify(results.violations, null, 2)).toEqual([]);
});

test('every floor control is at least 44px', async ({ page }) => {
  await page.goto(STATION);
  const labels = page.locator('.floor-option label');
  const n = await labels.count();
  expect(n).toBeGreaterThan(3);
  for (let i = 0; i < n; i++) {
    const box = await labels.nth(i).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test('shows step-by-step wheelchair directions for 大門 and changes them with the profile', async ({
  page,
}) => {
  await page.goto(STATION);
  const planner = page.getByRole('region', { name: '駅の中の道順' });
  const steps = planner.locator('ol.steps > li');
  await expect(steps.first()).toContainText('出発します');
  await expect(steps.last()).toContainText('番線ホームに着きます');
  await expect(planner.getByText(/ステップの道順を表示しています/)).toBeVisible();
  const text = await steps.allTextContents();
  expect(text.join('')).toContain('エレベーターで');
  expect(text.join('')).not.toMatch(/階段で|エスカレーターで/);
  // a profile that may use stairs gets a different route
  await planner.getByRole('radio', { name: '感覚過敏' }).check();
  await expect(steps.filter({ hasText: '階段で' }).first()).toBeVisible();
});

test('explains why 麻布十番 has no wheelchair route and offers alternatives', async ({ page }) => {
  await page.goto('/?basemap=off#/station/423');
  const alert = page.getByRole('alert').filter({ hasText: '道順が見つかりません' });
  await expect(alert).toBeVisible();
  await expect(alert.getByText(/8%超/)).toBeVisible();
  await expect(alert.getByRole('listitem').first()).toBeVisible();
});

test('directions follow the page language', async ({ page }) => {
  await page.goto(STATION);
  await page.getByLabel('言語').selectOption('en');
  await expect(page.getByText(/^Take the elevator at exit/).first()).toBeVisible();
});
