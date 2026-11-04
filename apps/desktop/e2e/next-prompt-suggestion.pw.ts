import { expect, test, type Locator, type Page } from '@playwright/test';
import { testModels } from '../../../shared/conversation/testing/models';
import type { Request, Thread } from '../../../shared/conversation/types';

const text = '按这个方案实现，完成后检查结果';
const thread: Thread = { id: 'prediction-thread', name: '预测测试', cwd: '', preview: '', updatedAt: 1,
  turns: [{ id: 'completed-turn', status: 'completed', items: [
    { id: 'user', type: 'userMessage', content: [{ type: 'text', text: '先给出深色模式的方案' }] },
    { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: '方案已准备好，可以开始实现。' },
  ] }] };
async function mockBackend(page: Page, wait?: Promise<void>) {
  const calls: Request[] = [];
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('**/__codex_switch__/api/invoke', async route => {
    const { command, args = {} } = route.request().postDataJSON();
    let result: unknown = {};
    if (command === 'codex_gui_cli_status') result = { version: '0.162.1' };
    if (command === 'codex_gui_connect') result = [];
    if (command === 'codex_gui_queue_read') result = { revision: 0, threads: {} };
    if (command === 'codex_gui_queue_save') result = args.snapshot;
    if (command === 'codex_gui_model_settings') result = { threadId: args.threadId ?? null,
      selection: { model: 'gpt-test', effort: 'high' }, revision: 0 };
    if (command === 'codex_gui_events') result = { cursor: { streamId: 'test', sequence: 1 }, reset: false, events: [] };
    if (command === 'codex_gui_git') result = { cwd: '', branch: null, branches: [], changedFiles: 0, isWorktree: false };
    if (command === 'codex_gui_usage_summary') result = { totalTokens: 0, estimatedCostUsd: 0,
      primaryRemainingPercent: null, primaryRemainingAggregated: false, providerEstimatedCost: null };
    if (command === 'codex_gui_request') {
      const request: Request = args.request; calls.push(request);
      let data: unknown = { data: [], nextCursor: null };
      if (request.operation === 'models') data = { data: testModels, nextCursor: null };
      if (request.operation === 'list') data = { data: [thread], nextCursor: null };
      if (request.operation === 'read' || request.operation === 'resume') data = { thread };
      if (request.operation === 'goals') data = { goals: [] };
      if (request.operation === 'goalGet') data = { goal: null };
      if (request.operation === 'plugins') data = { marketplaces: [], marketplaceLoadErrors: [] };
      if (request.operation === 'send') data = { turn: { id: 'next', status: 'inProgress', items: [] } };
      if (request.operation === 'suggestNextPrompt') { await wait; data = { suggestion: text }; }
      result = { data };
    }
    await route.fulfill({ json: { ok: true, result } });
  });
  return calls;
}
async function openThread(page: Page, dark = false) {
  await page.goto('/e2e/gui-features-harness.html' + (dark ? '?dark' : ''));
  const expand = page.getByRole('button', { name: '展开对话列表', exact: true });
  if (await expand.isVisible()) await expand.click();
  await page.getByRole('button', { name: '预测测试', exact: true }).click();
  return page.getByRole('textbox', { name: '消息', exact: true });
}

async function expectPlaceholderLayout(editor: Locator, ghost: Locator) {
  const input = (await editor.boundingBox())!;
  const suggestion = (await ghost.locator('span').boundingBox())!;
  const padding = await editor.evaluate(node => {
    const style = getComputedStyle(node);
    return { top: parseFloat(style.paddingTop), left: parseFloat(style.paddingLeft) };
  });
  expect(suggestion.x - input.x).toBeCloseTo(padding.left, 1);
  expect(suggestion.y - input.y).toBeCloseTo(padding.top, 1);
  expect(input.height - suggestion.height).toBeCloseTo(2, 1);
  const accept = ghost.getByRole('button', { name: '填入建议', exact: true });
  await expect(accept).toHaveText('Tab');
  const keycap = await accept.evaluate(node => ({
    height: node.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(node).lineHeight),
  }));
  expect(keycap.height - keycap.lineHeight).toBeCloseTo(2, 1);
}

for (const dark of [false, true]) {
  test('ghost stays translucent and only Tab accepts it (' + (dark ? 'dark' : 'light') + ')', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: dark ? 900 : 1440, height: 900 });
    const calls = await mockBackend(page);
    const editor = await openThread(page, dark);
    const ghost = page.getByTestId('next-prompt-suggestion');
    await expect(ghost.locator('span')).toHaveText(text);
    await expect(editor).toHaveText('');
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
    await expect(ghost).toHaveCSS('opacity', '0.45');
    await expect(ghost).toHaveCSS('pointer-events', 'none');
    expect((await ghost.boundingBox())!.width).toBeLessThanOrEqual(400);
    await expectPlaceholderLayout(editor, ghost);
    await editor.press('Enter'); expect(calls.some(call => call.operation === 'send')).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('suggestion.png'), caret: 'initial' });
    await editor.press('Tab');
    await expect(editor).toHaveText(text); await expect(ghost).toHaveCount(0);
    expect(calls.some(call => call.operation === 'send')).toBe(false);
    await editor.press('Enter');
    await expect.poll(() => calls.filter(call => call.operation === 'send').length).toBe(1);
    expect(calls.find(call => call.operation === 'send')).toMatchObject({ text });
  });
}

test('typing remains responsive and clearing the draft restores the pending suggestion', async ({ page }) => {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const calls = await mockBackend(page, wait);
  const editor = await openThread(page);
  await expect.poll(() => calls.some(call => call.operation === 'suggestNextPrompt')).toBe(true);
  const beat = Number(await page.getByLabel('刷新次数').textContent());
  try {
    await editor.fill('先检查我自己的修改');
    await expect(editor).toHaveText('先检查我自己的修改');
    await expect.poll(async () => Number(await page.getByLabel('刷新次数').textContent())).toBeGreaterThan(beat);
  } finally { release(); }
  await expect.poll(() => calls.filter(call => call.operation === 'suggestNextPrompt').length).toBe(1);
  await editor.clear();
  await expect(page.getByTestId('next-prompt-suggestion')).toBeVisible();
  await editor.press('Tab'); await expect(editor).toHaveText(text);
});

for (const width of [390, 1440]) test.describe(`touchscreen composer (${width}px)`, () => {
  test.use({ viewport: { width, height: 844 }, hasTouch: true, isMobile: width === 390 });
  test('fills through a touch action and sends only after confirmation', async ({ page }, info) => {
    const calls = await mockBackend(page);
    const editor = await openThread(page);
    const accept = page.getByRole('button', { name: '填入建议', exact: true });
    await expect(accept).toBeVisible();
    const ghost = page.getByTestId('next-prompt-suggestion');
    const bounds = (await ghost.boundingBox())!;
    expect(bounds.width).toBeLessThanOrEqual(400);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await expectPlaceholderLayout(editor, ghost);
    await editor.tap();
    await page.screenshot({ path: info.outputPath('touch-suggestion.png'), caret: 'initial' });
    await accept.tap();
    await expect(editor).toHaveText(text); await expect(editor).toBeFocused();
    expect(calls.some(call => call.operation === 'send')).toBe(false);
    await page.getByRole('button', { name: '发送消息', exact: true }).tap();
    await expect.poll(() => calls.filter(call => call.operation === 'send').length).toBe(1);
  });
  test('keeps the caret on the suggestion line and dismisses it when typing', async ({ page }) => {
    await mockBackend(page);
    const editor = await openThread(page);
    const ghost = page.getByTestId('next-prompt-suggestion');
    await expect(ghost).toBeVisible();
    await editor.tap();
    await expect(editor).toBeFocused();
    await expectPlaceholderLayout(editor, ghost);
    await editor.press('Tab');
    await expect(editor).toHaveText(text);
    await expect(ghost).toHaveCount(0);

    await page.reload();
    await expect(ghost).toBeVisible();
    await editor.press('a');
    await expect(editor).toHaveText('a');
    await expect(ghost).toHaveCount(0);
    await editor.clear();
    await expect(ghost).toBeVisible();
  });
});
