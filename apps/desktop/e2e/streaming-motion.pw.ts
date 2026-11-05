import { expect, test } from '@playwright/test';
import type { Conversation } from '../../../shared/conversation/types';

test('a long streaming reply does not animate its paragraphs or processing label', async ({ page }) => {
  const text = Array.from({ length: 40 }, (_, index) =>
    `### 检查结果 ${index}\n\n正在检查 **并发对话**，正文、链接和代码应保持清晰。\n\n\`const index = ${index}\``).join('\n\n');
  const fixture: Conversation = { thread: { id: 'live', cwd: '', preview: '', updatedAt: 1 },
    activeTurn: 'turn', tokens: 0, error: '', turns: [{ id: 'turn', status: 'inProgress', items: [
      { id: 'answer', type: 'agentMessage', phase: 'final_answer', text },
    ] }] };
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/history-fixture.json', route => route.fulfill({ json: fixture }));
  await page.goto('/e2e/tool-history-harness.html');
  const response = page.locator('[data-quote-source="answer"]');
  await expect(response).toContainText('检查结果 39');
  await expect(page.locator('[data-streaming="true"]')).toHaveCount(1);
  expect(await response.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(response.locator('p').first()).toHaveCSS('background-image', 'none');
  const status = page.locator('[data-processing-phase]');
  await expect(status).toBeVisible();
  expect(await status.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  await page.getByLabel('消息', { exact: true }).fill('回复生成期间继续输入');
  await expect(page.getByLabel('消息', { exact: true })).toHaveValue('回复生成期间继续输入');
  await page.screenshot({ path: '../../.codex-tmp/static-streaming-reply.png' });
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
  expect(await response.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  expect(await response.locator('p').first().evaluate(node => getComputedStyle(node).webkitTextFillColor))
    .not.toBe('rgba(0, 0, 0, 0)');
});
