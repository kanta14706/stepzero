/// <reference lib="dom" />
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Needs the importer output in public/data (`pnpm sync-data`), like station-map.spec.ts. */
test.beforeEach(async ({ request }) => {
  const res = await request.get('/data/graphs/index.json');
  test.skip(!res.ok(), 'station data not built (run the importer, then pnpm sync-data)');
});

const STATION = '/?basemap=off#/station/421'; // has a wheelchair route
const NO_ROUTE_STATION = '/?basemap=off#/station/423'; // 麻布十番: only an 8-18% ramp
const LANGS = ['ja', 'en', 'zh-Hant', 'ja-easy'] as const;
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function setLanguage(page: Page, lang: string): Promise<void> {
  await page.locator('#language-select').selectOption(lang);
}

async function expectNoSeriousViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

async function waitForRoute(page: Page): Promise<void> {
  await expect(page.locator('ol.steps > li').first()).toBeVisible();
  await expect(page.locator('.station-map canvas')).toBeVisible();
}

for (const lang of LANGS) {
  test(`axe: station page with a route and a selected step, ${lang}`, async ({ page }) => {
    await page.goto(STATION);
    await setLanguage(page, lang);
    await waitForRoute(page);
    await expectNoSeriousViolations(page);
    await page.locator('.step-button').nth(2).click();
    await expect(page.locator('.step-button[aria-pressed="true"]')).toHaveCount(1);
    await expectNoSeriousViolations(page);
  });

  test(`axe: station page with no route, ${lang}`, async ({ page }) => {
    await page.goto(NO_ROUTE_STATION);
    await setLanguage(page, lang);
    await expect(page.locator('.no-route')).toBeVisible();
    await expectNoSeriousViolations(page);
  });
}

test('axe: dark mode and increased contrast', async ({ page }) => {
  await page.goto(STATION);
  await waitForRoute(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectNoSeriousViolations(page);
  await page.emulateMedia({ colorScheme: 'light', contrast: 'more' });
  await expectNoSeriousViolations(page);
  await page.emulateMedia({ colorScheme: 'dark', contrast: 'more' });
  await expectNoSeriousViolations(page);
});

test('headings form an outline with no skipped levels, with a route and without', async ({
  page,
}) => {
  for (const url of [STATION, NO_ROUTE_STATION]) {
    await page.goto(url);
    await expect(page.locator('ol.steps > li, .no-route').first()).toBeVisible();
    const levels = await page
      .locator('main h1, main h2, main h3, main h4, main h5, main h6, header h1')
      .evaluateAll((hs) => hs.map((h) => Number(h.tagName.slice(1))));
    expect(levels.length).toBeGreaterThan(3);
    levels.forEach((level, i) => {
      if (i > 0)
        expect(level - (levels[i - 1] ?? 0), `${url}: ${levels.join(',')}`).toBeLessThanOrEqual(1);
    });
  }
});

test('reading order: planner controls, then directions, then the floor map and its list', async ({
  page,
}) => {
  await page.goto(STATION);
  await waitForRoute(page);
  const order = await page.evaluate(() => {
    const at = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? [...document.querySelectorAll('*')].indexOf(el) : -1;
    };
    return {
      direction: at('.planner fieldset'),
      entrance: at('.planner .field select'),
      steps: at('ol.steps'),
      status: at('.planner [role="status"]'),
      floors: at('.floor-switcher'),
      map: at('.station-map'),
      list: at('.floor-list'),
    };
  });
  const sequence = [
    order.direction,
    order.entrance,
    order.status,
    order.steps,
    order.floors,
    order.map,
    order.list,
  ];
  expect(
    sequence.every((n) => n >= 0),
    JSON.stringify(order),
  ).toBe(true);
  expect(sequence, JSON.stringify(order)).toEqual([...sequence].sort((a, b) => a - b));
});

test('keyboard: every control is reachable in order and the page has no focus trap', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'keyboard walkthrough runs on the desktop project');
  await page.goto(STATION);
  await waitForRoute(page);
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  const seen: string[] = [];
  let reachedEnd = false;
  for (let i = 0; i < 120; i++) {
    await page.keyboard.press('Tab');
    const label = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return 'BODY';
      const labels = [...((el as HTMLInputElement).labels ?? [])];
      const name = el.getAttribute('aria-label') ?? labels.at(0)?.textContent ?? el.textContent;
      return `${el.tagName.toLowerCase()}:${name.trim().slice(0, 30)}`;
    });
    if (label === 'BODY') {
      reachedEnd = true;
      break;
    }
    seen.push(label);
  }
  expect(reachedEnd, `focus never left the page: ${seen.slice(-8).join(' | ')}`).toBe(true);
  const index = (prefix: string) => seen.findIndex((s) => s.startsWith(prefix));
  const order = [
    index('select:言語'),
    index('a:駅の一覧へ戻る'),
    index('input:駅に入る'), // the checked direction radio
    index('select:出入口'),
    index('select:ホーム'),
    index('input:車いす'), // the checked profile radio
    index('button:道順の一覧を飛ばして'),
    index('button:地図で見る：ステップ1'),
    index('input:地上'), // the checked floor radio
  ];
  expect(
    order.every((n) => n >= 0),
    JSON.stringify({ order, seen }),
  ).toBe(true);
  expect(order, JSON.stringify(seen)).toEqual([...order].sort((a, b) => a - b));
});

test('keyboard: Enter and Space toggle a step on the map; the focus ring is visible', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'keyboard walkthrough runs on the desktop project');
  await page.goto(STATION);
  await waitForRoute(page);
  const second = page.getByRole('button', { name: '地図で見る：ステップ2' });
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  for (let i = 0; i < 60 && !(await second.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(second).toBeFocused();
  const ring = await second.evaluate((el) => {
    const s = getComputedStyle(el);
    return { width: parseFloat(s.outlineWidth), style: s.outlineStyle };
  });
  expect(ring.style).not.toBe('none');
  expect(ring.width).toBeGreaterThanOrEqual(2);
  await page.keyboard.press('Enter');
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(second).toHaveAttribute('aria-pressed', 'false');
  await expect(second).toBeFocused(); // pressing it does not steal the focus
});

test('keyboard: arrow keys change the profile and the route updates', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'keyboard walkthrough runs on the desktop project');
  await page.goto(STATION);
  await waitForRoute(page);
  // From A1 the stairs are faster than the lifts (from the nearest entrance every profile takes
  // the lift, D-023).
  await page.getByLabel('出入口', { exact: true }).selectOption({ label: 'A1出入口' });
  await expect(page.locator('ol.steps > li').first()).toContainText('A1出入口から出発します');
  const wheelchair = page.getByRole('radio', { name: '車いす' });
  await wheelchair.focus();
  const before = await page.locator('ol.steps > li').count();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown'); // to 感覚過敏
  await expect(page.getByRole('radio', { name: '感覚過敏' })).toBeChecked();
  await expect(page.locator('ol.steps > li').filter({ hasText: '階段で' }).first()).toBeVisible();
  expect(await page.locator('ol.steps > li').count()).not.toBe(before);
});

test('planner controls are at least 44px', async ({ page }) => {
  await page.goto(STATION);
  await waitForRoute(page);
  for (const selector of ['.planner .choice', '.planner .field select', '.step-button']) {
    const boxes = await page.locator(selector).evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { w: r.width, h: r.height };
      }),
    );
    expect(boxes.length, selector).toBeGreaterThan(0);
    for (const b of boxes) {
      expect(b.h, selector).toBeGreaterThanOrEqual(44);
      expect(b.w, selector).toBeGreaterThanOrEqual(44);
    }
  }
});

test('changing a choice announces the new route in a polite live region', async ({ page }) => {
  await page.goto(STATION);
  await waitForRoute(page);
  const status = page.locator('.planner [role="status"]');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await expect(status).toContainText('ステップの道順を表示しています');
  await page.getByRole('radio', { name: '感覚過敏' }).check();
  await expect(status).toContainText('ステップの道順を表示しています');
  await page.goto(NO_ROUTE_STATION);
  await expect(page.locator('.planner [role="status"]')).toContainText('道順が見つかりません');
});

for (const [lang, zoomIn] of [
  ['ja', '拡大'],
  ['en', 'Zoom in'],
  ['zh-Hant', '放大'],
  ['ja-easy', 'おおきく する'],
] as const) {
  test(`the map's own controls speak the page language, ${lang}`, async ({ page }) => {
    await page.goto(STATION);
    await setLanguage(page, lang);
    await waitForRoute(page);
    // the map is rebuilt with the new labels when the language changes
    await expect(page.locator('.station-map').getByRole('button', { name: zoomIn })).toBeVisible();
    await expect(page.locator('.station-map canvas')).not.toHaveAttribute('aria-label', 'Map');
    // the canvas is a region of its own inside the labelled wrapper: the two names must differ
    const names = await page
      .locator('.station-map, .station-map canvas')
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    expect(new Set(names).size).toBe(2);
  });
}

test('keyboard: the skip button jumps past the step list to the floor choice', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'keyboard walkthrough runs on the desktop project');
  await page.goto(STATION);
  await waitForRoute(page);
  const skip = page.getByRole('button', { name: /道順の一覧を飛ばして/ });
  await skip.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('radio', { name: '地上' })).toBeFocused();
  // from there the next Tab reaches the map, not a step button
  await page.keyboard.press('Tab');
  await expect(page.locator('.station-map canvas')).toBeFocused();
});
