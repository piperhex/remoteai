import { expect, test } from '@playwright/test';
import { explorerShortcuts } from './project-explorer-fixture';

// A cold Vite transform can exceed the default test budget before the picker is mounted.
// Request deadlines below still use an explicit 15-second virtual clock assertion.
test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
});

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: stalled roots time out and retry restores drives and shortcuts`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`/e2e/project-explorer-harness.html?mode=${mode}&computer&stalled`,
      { waitUntil: 'domcontentloaded' });
    await page.clock.install();
    await page.locator('button[aria-haspopup="menu"]').first().click();
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await expect(page.locator('.pe-files')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('button', { name: '刷新', exact: true })).toBeEnabled();
    await page.clock.fastForward(15_000);
    await expect(page.locator('.pe-files')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('alert')).toContainText('无法读取文件夹');
    await page.screenshot({ path: `../../.codex-tmp/project-explorer-loading/${mode}-light-timeout.png` });
    await page.evaluate(() => (window as unknown as { explorerBlockedPaths: Set<string> })
      .explorerBlockedPaths.clear());
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(page.getByRole('option')).toHaveCount(2);
    for (const shortcut of await page.locator('.pe-shortcuts button').all()) await expect(shortcut).toBeEnabled();
    await page.screenshot({ path: `../../.codex-tmp/project-explorer-loading/${mode}-light-computer.png` });
    await page.locator('.pe-shortcuts button').nth(1).click();
    await expect(page.locator('.pe-footer input')).toHaveValue(explorerShortcuts.desktop);
  });

  test(`${mode}: stalled folder keeps shortcuts and back navigation usable`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`/e2e/project-explorer-harness.html?mode=${mode}&stalled&dark`,
      { waitUntil: 'domcontentloaded' });
    await page.locator('button[aria-haspopup="menu"]').first().click();
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await expect(page.locator('.pe-files')).toHaveAttribute('aria-busy', 'true');
    await page.locator('.pe-shortcuts button').first().click();
    await expect(page.locator('.pe-footer input')).toHaveValue(explorerShortcuts.home);
    await page.getByRole('button', { name: '后退', exact: true }).click();
    await expect(page.locator('.pe-files')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('button', { name: '前进', exact: true })).toBeEnabled();
    await page.screenshot({ path: `../../.codex-tmp/project-explorer-loading/${mode}-dark-stalled-folder.png` });
    await page.getByRole('button', { name: '前进', exact: true }).click();
    await expect(page.locator('.pe-files')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.pe-footer input')).toHaveValue(explorerShortcuts.home);
    await page.screenshot({ path: `../../.codex-tmp/project-explorer-loading/${mode}-dark-home.png` });
  });
}
