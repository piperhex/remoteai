import { expect, test } from '@playwright/test';
import type { Thread } from '../../../shared/conversation/types';

const thread: Thread = { id: 'navigation', cwd: '', preview: '', updatedAt: 0, turns: [
  { id: 'single-turn', status: 'inProgress', items: [
    { id: 'single', type: 'commandExecution', status: 'completed', command: 'echo single',
      aggregatedOutput: 'SINGLE_OUTPUT' },
  ] },
  { id: 'group-turn', status: 'inProgress', items: [
    { id: 'first', type: 'commandExecution', status: 'completed', command: 'echo first',
      aggregatedOutput: 'FIRST_OUTPUT' },
    { id: 'second', type: 'commandExecution', status: 'inProgress', command: 'echo second',
      aggregatedOutput: 'SECOND_OUTPUT' },
  ] },
] };

for (const dark of [false, true]) test(`mobile web ${dark ? 'dark' : 'light'}: details follow navigation`,
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ body: '' }));
    await page.addInitScript(font => localStorage.setItem('codex-switch:global-font-size', String(font)), dark ? 20 : 14);
    await page.route('**/process-history.json*', route => route.fulfill({
      json: { thread, page: { hasMore: false } },
    }));
    await page.goto(`/e2e/process-history-harness.html?mode=web${dark ? '&dark' : ''}`, {
      waitUntil: 'domcontentloaded',
    });
    const single = page.locator('[data-message-id="single"] .chat-activity');
    const group = page.locator('[data-message-id="group-turn:activities:first"] .chat-activity');
    const sheet = page.locator('.mobile-popup');
    const prefix = `../../.codex-tmp/command-detail-investigation/web-mobile-${dark ? 'dark-large' : 'light'}`;
    await single.click();
    await expect(sheet).toContainText('SINGLE_OUTPUT');
    await page.screenshot({ path: `${prefix}-single-command.png` });
    await sheet.locator('.sheet-close').click();
    await expect(sheet).toHaveCount(0);
    await page.getByRole('button', { name: '离开对话', exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await page.getByRole('button', { name: '返回对话', exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await group.click();
    await expect(sheet).toContainText('2 项活动');
    await sheet.locator('.chat-activity').filter({ hasText: 'echo first' }).click();
    await expect(sheet).toContainText('FIRST_OUTPUT');
    await page.screenshot({ path: `${prefix}-process-expanded.png` });
    // Model navigation from the application while a portal is open (for example, a device change).
    await page.locator('header button').evaluate((button: HTMLButtonElement) => button.click());
    await expect(sheet).toHaveCount(0);
    await page.getByRole('button', { name: '返回对话', exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await expect(single).toBeVisible();
    await page.screenshot({ path: `${prefix}-returned-without-details.png` });
    await page.getByRole('button', { name: '查看处理过程，2 项活动', exact: true }).click();
    await expect(sheet).toContainText('2 项活动');
    await page.screenshot({ path: `${prefix}-process-reopened.png` });
    for (let cycle = 0; cycle < 2; cycle++) {
      await sheet.locator('.sheet-close').click();
      await single.click(); await expect(sheet).toContainText('SINGLE_OUTPUT');
      await sheet.locator('.sheet-close').click();
      await group.click(); await expect(sheet).toContainText('2 项活动');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
