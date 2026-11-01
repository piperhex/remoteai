import { expect, test } from '@playwright/test';
import type { Thread } from '../src/chat/types';

test('keeps streamed text, math, code and historical tool actions correct', async ({ page }, info) => {
  let thread: Thread = { id: 'rendering', cwd: '', preview: '', updatedAt: 1, turns: [
    { id: 'history', status: 'completed', items: [
      { id: 'question', type: 'userMessage', text: '检查流式回复与历史记录' },
      { id: 'command', type: 'commandExecution', command: 'npm test', aggregatedOutput: 'PASS original',
        status: 'completed', exitCode: 0 },
      { id: 'old', type: 'agentMessage', text: '历史回复保留 **格式**、公式 $x^2$ 和代码。\n\n```js\nconst answer = 42;\n```' },
    ] },
    { id: 'live', status: 'inProgress', items: [{ id: 'active', type: 'agentMessage', text: '正在输出：' }] },
  ] };
  await page.route('**/display-fixture.json', route => route.fulfill({ json: thread }));
  await page.goto('e2e/chat-display-harness.html');
  await expect(page.locator('[data-message-id="old"] .katex')).toHaveCount(1);
  for (let index = 0; index < 12; index++) {
    thread = { ...thread, turns: [thread.turns![0], { ...thread.turns![1], items: [
      { id: 'active', type: 'agentMessage', text: `正在输出：${'有序增量 '.repeat(index + 1)}` },
    ] }] };
    await page.evaluate(detail => window.dispatchEvent(new CustomEvent('display-fixture', { detail })), thread);
    await expect(page.locator('[data-message-id="active"]')).toContainText('有序增量 '.repeat(index + 1).trim());
  }
  await page.screenshot({ path: `../../.codex-tmp/task1-rendering/${info.project.name}-streaming.png` });
  thread = { ...thread, turns: thread.turns!.map(turn => ({ ...turn, status: 'completed' })) };
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent('display-fixture', { detail })), thread);
  await expect(page.locator('[data-message-id="active"] .chat-message-actions')).toBeVisible();
  await expect(page.locator('[data-message-id="old"] pre')).toContainText('const answer = 42;');
  const work = page.locator('.chat-work-summary button').first();
  await work.click();
  const command = page.getByRole('button', { name: /npm test/ }).first();
  await expect(command).toBeVisible();
  await command.click();
  await expect(page.getByText('PASS original', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: `../../.codex-tmp/task1-rendering/${info.project.name}-history-action.png` });
});
