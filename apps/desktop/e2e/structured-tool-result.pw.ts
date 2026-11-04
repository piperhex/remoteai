import { expect, test } from '@playwright/test';
import type { Conversation } from '../../../shared/conversation/types';

test.beforeEach(async ({ page }) => {
  // Visual fixtures use system fonts so external font downloads cannot stall offline checks.
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});

const structured = {
  conversations: [
    { name: '检查工作进度与验证结果', status: 'running', cwd: 'F:\\projects\\codex-switch' },
    { name: '整理界面显示与复制操作', status: 'running', cwd: 'F:\\projects\\codex-switch' },
  ],
  nextCursor: null, total: 2, text: '**这是数据字段，保留原样**',
};
const result = { content: [{ type: 'text', text: JSON.stringify(structured) }], structuredContent: structured };
const conversation: Conversation = {
  thread: { id: 'structured', cwd: '', preview: '', updatedAt: 1 },
  activeTurn: 'turn', tokens: 0, error: '', turns: [{ id: 'turn', status: 'inProgress', items: [
    { id: 'tool', type: 'mcpToolCall', tool: 'gui_list_running_conversations', status: 'completed', result },
  ] }],
};

for (const mode of ['local', 'remote', 'web']) {
  for (const fontSize of [14, 20]) {
    test(`${mode}: structured data and raw copy at font ${fontSize}`, async ({ page, context }, info) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.setViewportSize({ width: fontSize === 14 ? 1280 : 900, height: 900 });
      await page.addInitScript(size => localStorage.setItem('codex-switch:global-font-size', String(size)), fontSize);
      await page.route('**/history-fixture.json', route => route.fulfill({ json: conversation }));
      await page.goto(`/e2e/image-history-harness.html?mode=${mode}`);
      if (mode !== 'local') {
        const process = page.locator('.chat-desktop-work button');
        if (await process.getAttribute('aria-expanded') !== 'true') await process.click();
      }
      const tool = mode === 'local' ? page.locator('[data-message-id="tool"] > details > summary')
        : page.locator('[data-message-id="tool"] .chat-activity');
      await tool.click();
      const output = page.locator('pre');
      await expect(output).toHaveCount(1);
      await expect(output).toHaveText(JSON.stringify(structured, null, 2));
      await expect(page.locator('details > summary').filter({ hasText: '结构化结果' })).toHaveCount(0);
      await expect(page.locator('.chat-tool-markdown')).toHaveCount(0);
      const copy = page.getByRole('button', { name: '复制原始数据', exact: true });
      await expect(copy).toHaveCount(1);
      await copy.scrollIntoViewIfNeeded();
      const box = (await output.boundingBox())!;
      expect((await copy.boundingBox())!.y).toBeGreaterThan(box.y);
      await copy.click();
      await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n')))
        .toBe(JSON.stringify(result, null, 2));
      await expect(copy).toBeVisible();
      await expect(page.locator('.adm-toast-main')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`${mode}-light-font-${fontSize}.png`), animations: 'disabled' });
      await page.getByRole('button', { name: 'Theme', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      if (mode === 'local') {
        await expect.poll(() => copy.evaluate(node => getComputedStyle(node).color
          === getComputedStyle(node.parentElement!).color)).toBe(true);
      }
      await page.screenshot({ path: info.outputPath(`${mode}-dark-font-${fontSize}.png`), animations: 'disabled' });
    });
  }
}
