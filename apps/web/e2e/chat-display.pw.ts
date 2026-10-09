import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { Item, Thread } from '../src/chat/types';
import { screenshot } from './chat-helpers';

const code = `const message = '${'长内容'.repeat(80)}';`;
const reply: Item = { id: 'answer', type: 'agentMessage', phase: 'final_answer', status: 'completed',
  text: '## 展示测试\n\n包含**粗体**与`行内代码`。\n\n| 项目 | 状态 |\n|---|---|\n|文本|正常|'
    + `\n\n\`\`\`typescript\n${code}\n\`\`\`\n\n展示完成。` };
const command: Item = { id: 'command', type: 'commandExecution', status: 'inProgress',
  command: 'npm test', aggregatedOutput: 'COMMAND-START' };
function fixture(items: Item[], running = false): Thread {
  return { id: 'display', cwd: '', preview: '展示测试', updatedAt: 1, turns: [{ id: 'turn',
    status: running ? 'inProgress' : 'completed', startedAt: Date.now() / 1000, durationMs: 32000,
    items: [{ id: 'user', type: 'userMessage', text: '展示标题、表格、代码与命令结果。' }, ...items] }] };
}
async function open(page: Page, value: Thread) {
  await page.route('**/display-fixture.json', route => route.fulfill({ json: value }));
  await page.goto('e2e/chat-display-harness.html');
}
async function update(page: Page, value: Thread) {
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent('display-fixture', { detail })), value);
}
test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop'
  && !info.title.startsWith('preserves reading and typing'), 'PC message presentation'));

test('copies and expands tables, wraps long code and contains overflow', async ({ page }, info) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page, fixture([reply]));
  const header = await page.locator('.chat-header').boundingBox();
  const footer = await page.locator('footer').boundingBox();
  await page.getByRole('region', { name: '表格', exact: true }).hover();
  await page.getByRole('button', { name: '复制表格', exact: true }).click();
  expect(await page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n')))
    .toBe('项目\t状态\n文本\t正常');
  await page.getByRole('button', { name: '展开表格' }).click();
  await expect(page.getByRole('region', { name: '完整表格' })).toContainText('文本');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const pre = page.locator('.chat-code-block pre');
  expect(await pre.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  await page.getByRole('button', { name: '自动换行' }).click();
  expect(await pre.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.getByRole('button', { name: '复制代码' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
  expect(await page.locator('.chat-header').boundingBox()).toEqual(header);
  expect(await page.locator('footer').boundingBox()).toEqual(footer);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1280);
  await screenshot(page, info, 'desktop-rich-reply');
});

test('places image thumbnails above the bubble and keeps image-only messages free of empty bubbles',
  async ({ page }, info) => {
    const url = 'data:image/png;base64,' + readFileSync('../desktop/src-tauri/icons/128x128.png').toString('base64');
    const value = fixture([reply]);
    value.turns![0].items[0].content = [{ type: 'image', url }, { type: 'image', url }];
    await open(page, value);
    const user = page.locator('[data-message-id="user"]');
    const images = user.locator('.chat-image');
    await expect(images).toHaveCount(2);
    const image = (await images.last().boundingBox())!;
    const bubble = (await user.locator('.chat-user-message').boundingBox())!;
    expect(image.width).toBeLessThanOrEqual(80);
    expect(image.y + image.height).toBeLessThan(bubble.y);
    expect(Math.abs(image.x + image.width - bubble.x - bubble.width)).toBeLessThan(2);
    await images.first().click();
    const original = page.getByRole('dialog').locator('img');
    await expect.poll(async () => (await original.boundingBox())?.width).toBe(128);
    await page.keyboard.press('Escape');
    value.turns![0].items[0].text = '';
    await update(page, value);
    await expect(user.locator('.chat-user-message')).toHaveCount(0);
    await screenshot(page, info, 'desktop-sent-images');
  });

test('collapses completed work automatically but preserves an inspected command and its output', async ({ page }) => {
  const value = fixture([command], true);
  await open(page, value);
  const work = page.getByRole('button', { name: /查看处理过程/ });
  await expect(work).toHaveAttribute('aria-expanded', 'true');
  value.turns![0].status = 'completed';
  await update(page, value);
  await expect(work).toHaveAttribute('aria-expanded', 'false');
  value.turns![0].status = 'inProgress';
  await update(page, value);
  await page.getByRole('button', { name: /执行命令.*npm test/ }).click();
  await expect(page.getByText('COMMAND-START', { exact: true })).toBeVisible();
  value.turns![0].status = 'completed';
  value.turns![0].items[1] = { ...command, status: 'completed', aggregatedOutput: 'COMMAND-END', exitCode: 0 };
  value.turns![0].items.push(reply);
  await update(page, value);
  await expect(work).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('COMMAND-END', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('shows one stop notice before the partial response and keeps the next response independent', async ({ page }) => {
  const value = fixture([{ ...reply, text: '部分回复仍可阅读。' }]);
  value.turns![0].status = 'interrupted';
  value.turns![0].startedAt = undefined;
  value.turns![0].durationMs = undefined;
  await open(page, value);
  const stopped = page.getByText('已停止生成', { exact: true });
  await expect(stopped).toHaveCount(1);
  const response = page.getByText('部分回复仍可阅读。');
  expect((await stopped.boundingBox())!.y).toBeLessThan((await response.boundingBox())!.y);
  value.turns!.push({ id: 'next', status: 'completed', items: [
    { id: 'next-user', type: 'userMessage', text: '继续' }, { ...reply, id: 'next-answer', text: '后续对话正常' },
  ] });
  await update(page, value);
  await expect(stopped).toHaveCount(1);
  await expect(page.getByText('后续对话正常')).toBeVisible();
});

async function checkSelectionQuoteDismissal(page: Page) {
  const paragraph = page.locator('.chat-assistant-message p').nth(10);
  await paragraph.evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  const quote = page.getByRole('button', { name: '引用选中文字并回复' });
  await expect(quote).toBeVisible();
  await page.getByLabel('聊天记录').evaluate(node => {
    node.scrollTop += 100; node.dispatchEvent(new Event('scroll'));
  });
  await expect(quote).toHaveCount(0);
  await page.evaluate(() => document.dispatchEvent(new Event('selectionchange')));
  await expect(quote).toHaveCount(0);
}

test('preserves reading and typing during streaming and dismisses selection quotes on scroll', async ({ page }, info) => {
  const value = fixture([{ ...reply, text: Array.from({ length: 80 }, (_, i) => `第 ${i + 1} 段：历史消息。`)
    .join('\n\n'), status: 'inProgress' }], true);
  await open(page, value);
  const viewport = page.getByLabel('聊天记录');
  const processing = viewport.locator('.chat-message-content > .chat-processing-status');
  await expect(processing).toBeInViewport();
  await expect(processing).toContainText(/共计.*秒/);
  const lastReply = page.locator('.chat-assistant-message p').last();
  const replyBounds = (await lastReply.boundingBox())!;
  expect((await processing.boundingBox())!.y).toBeGreaterThanOrEqual(replyBounds.y + replyBounds.height);
  await viewport.evaluate(node => { node.scrollTop = 400; node.dispatchEvent(new Event('scroll')); });
  await expect(processing).not.toBeInViewport();
  const input = page.getByRole('textbox', { name: '消息' });
  await input.fill('保留正在输入的草稿');
  const position = await viewport.evaluate(node => node.scrollTop);
  value.turns![0].items[1].text += '\n\n追加的流式内容。';
  await update(page, value);
  expect(await viewport.evaluate(node => node.scrollTop)).toBe(position);
  await expect(input).toHaveValue('保留正在输入的草稿');
  if (info.project.name === 'desktop') await checkSelectionQuoteDismissal(page);
  await page.getByRole('button', { name: '回到底部' }).click();
  await expect(page.getByText('追加的流式内容。')).toBeVisible();
  await expect(processing).toBeInViewport();
  await page.screenshot({ path: info.outputPath('processing-follow.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(processing).toBeInViewport();
  expect(await viewport.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('processing-follow-narrow.png'), animations: 'disabled' });
  value.turns![0].status = 'completed';
  await update(page, value);
  await expect(processing).toHaveCount(0);
});

test('keeps long messages readable in a narrow desktop conversation pane', async ({ page }, info) => {
  const value = fixture([reply]);
  value.turns![0].items[0].text = '两侧菜单展开后，消息仍然应当方便阅读。'.repeat(12);
  await open(page, value);
  await page.locator('.chat-conversation').evaluate(node => { node.style.maxWidth = '420px'; });
  const pane = (await page.locator('.chat-message-region').boundingBox())!;
  const bubble = (await page.locator('.chat-user-message').boundingBox())!;
  expect(bubble.width).toBeGreaterThan(pane.width * .8);
  expect(bubble.width).toBeLessThan(pane.width);
  expect(await page.locator('.chat-messages').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.getByRole('button', { name: '自动换行' }).click();
  await expect(page.getByRole('textbox', { name: '消息' })).toBeVisible();
  await screenshot(page, info, 'desktop-narrow-pane');
});
