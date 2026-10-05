import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const LANGS = [
  { value: 'ja', html: 'ja' },
  { value: 'en', html: 'en' },
  { value: 'zh-Hant', html: 'zh-Hant' },
  { value: 'ja-easy', html: 'ja' },
] as const;

for (const { value, html } of LANGS) {
  test(`home page has no axe violations in ${value}`, async ({ page }) => {
    await page.goto('/');
    await page.locator('#language-select').selectOption(value);
    await expect(page.locator('html')).toHaveAttribute('lang', html);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    // CI fails on any serious or critical violation (CLAUDE.md); report all of them.
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
}

test('skip link moves focus to the main content', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: /本文へ移動/ });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
});

test('touch targets are at least 44px', async ({ page }) => {
  await page.goto('/');
  const box = await page.locator('#language-select').boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test('is installable: manifest and service worker are served', async ({ page, request }) => {
  await page.goto('/');
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  const json = (await manifest.json()) as { name: string; display: string };
  expect(json.display).toBe('standalone');
  expect((await request.get('/sw.js')).ok()).toBe(true);
});
