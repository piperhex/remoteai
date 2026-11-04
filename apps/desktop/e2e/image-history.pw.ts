import { expect, test, type Page } from '@playwright/test';
import type { Conversation } from '../../../shared/conversation/types';

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});

const IMAGE_COUNT = 180;
type Mode = 'local' | 'remote' | 'web';
const modes: Mode[] = ['local', 'remote', 'web'];

function history(): Conversation {
  return { thread: { id: 'image-history', cwd: '', preview: '', updatedAt: 1 },
    activeTurn: 'turn', tokens: 0, error: '', turns: [{ id: 'turn', status: 'inProgress', items:
      Array.from({ length: IMAGE_COUNT }, (_, index) => ({ id: `image-${index}`, type: 'agentMessage',
        phase: 'commentary', status: 'completed',
        text: `截图 ${index}\n\n![页面 ${index}](/C:/captures/image-${index}.png)\n\n检查页面布局和交互。` })),
    }] };
}

async function setup(page: Page, value: Conversation) {
  const requests: string[] = [];
  // A realistic image size exercises layout, decoding, and the viewport's measured placeholders.
  const url = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 360;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#eaf3ed'; context.fillRect(0, 0, 640, 360);
    context.fillStyle = '#248557'; context.fillRect(32, 32, 576, 60);
    context.fillStyle = '#fff'; context.fillRect(32, 116, 278, 210); context.fillRect(334, 116, 274, 210);
    context.fillStyle = '#213e2d'; context.font = '24px sans-serif'; context.fillText('Codex GUI', 52, 72);
    return canvas.toDataURL();
  });
  await page.route('**/history-fixture.json', route => route.fulfill({ json: value }));
  await page.route('**/image-preview.json', route => {
    requests.push(route.request().postDataJSON().source);
    return route.fulfill({ json: { url } });
  });
  await page.route('**/__codex_switch__/api/invoke', route => {
    const body = route.request().postDataJSON().args.request;
    expect(body.operation).toBe('imagePreview');
    requests.push(body.source);
    return route.fulfill({ json: { ok: true, result: { data: { url } } } });
  });
  return requests;
}

async function scrollTo(page: Page, mode: Mode, end: 'top' | 'bottom') {
  const viewport = mode === 'local' ? page.getByLabel('对话消息') : page.locator('.chat-messages');
  const bounds = (await viewport.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width - 16, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, end === 'top' ? -100_000 : 100_000);
  await expect.poll(() => viewport.evaluate((node, edge) => edge === 'top' ? node.scrollTop
    : node.scrollHeight - node.scrollTop - node.clientHeight, end)).toBeLessThan(2);
  return viewport;
}

for (const mode of modes) {
  test(`${mode}: many images stay bounded while scrolling and streaming`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const value = history();
    const requests = await setup(page, value);
    await page.goto(`/e2e/image-history-harness.html?mode=${mode}`);
    await expect(page.locator('[data-message-id="image-179"] img')).toBeVisible();
    expect(requests.length).toBeLessThan(40);
    expect(await page.locator('img').count()).toBeLessThan(20);
    await expect.poll(() => page.locator('[data-message-id] article').count()).toBeLessThan(20);
    await page.getByLabel('消息', { exact: true }).fill('图片很多时仍可输入');
    await page.screenshot({ path: `../../.codex-tmp/image-history-${mode}-latest.png` });
    const viewport = await scrollTo(page, mode, 'top');
    await expect(page.locator('[data-message-id="image-0"] img')).toBeVisible();
    await expect(page.locator('[data-message-id="image-179"] img')).toHaveCount(0);
    const position = await viewport.evaluate(node => node.scrollTop);
    value.turns[0].items.push({ id: 'new-message', type: 'agentMessage', phase: 'commentary', text: '新的进度。' });
    await page.evaluate(detail => window.dispatchEvent(new CustomEvent('conversation-fixture', { detail })), value);
    await expect(page.locator('[data-message-id="new-message"]')).toHaveCount(1);
    expect(Math.abs(await viewport.evaluate(node => node.scrollTop) - position)).toBeLessThan(2);
    await expect(page.getByLabel('消息', { exact: true })).toHaveValue('图片很多时仍可输入');
    await page.screenshot({ path: `../../.codex-tmp/image-history-${mode}-earlier.png` });
    await scrollTo(page, mode, 'bottom');
    await expect(page.locator('[data-message-id="image-179"] img')).toBeVisible();
    expect(await page.locator('img').count()).toBeLessThan(20);
  });

  test(`${mode}: structured data is visible when a tool opens and never treated as an image block`, async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 780 });
    const value = history();
    value.activeTurn = null;
    value.turns[0] = { id: 'turn', status: 'completed', items: [{ id: 'tool', type: 'mcpToolCall',
      tool: '截图检查', status: 'completed', arguments: { input: 'DEFERRED_INPUT' },
      result: { content: [{ type: 'text', text: '工具执行完成。' }],
        structuredContent: { type: 'inputImage', imageUrl: 'C:/captures/structured.png' } } }] };
    const requests = await setup(page, value);
    await page.goto(`/e2e/image-history-harness.html?mode=${mode}`);
    const process = mode === 'local' ? page.locator('summary[data-history-anchor]')
      : page.locator('.chat-desktop-work button');
    await expect(process).toBeVisible();
    expect(requests).toHaveLength(0);
    expect(await page.locator('pre, img').count()).toBe(0);
    await process.click();
    const tool = mode === 'local' ? page.locator('[data-message-id="tool"] > details > summary')
      : page.locator('[data-message-id="tool"] .chat-activity');
    await tool.click();
    expect(requests).toHaveLength(0);
    await expect(page.locator('pre')).toContainText('C:/captures/structured.png');
    await expect(page.locator('img')).toHaveCount(0);
    await page.screenshot({ path: `../../.codex-tmp/image-history-${mode}-collapsed.png` });
    const input = page.locator('details').filter({ has: page.locator(':scope > summary',
      { hasText: /^(查看输入|输入)$/ }) });
    await input.locator(':scope > summary').click();
    await expect(input).toContainText('DEFERRED_INPUT');
    await input.locator(':scope > summary').click();
    await expect(input.locator('pre')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '复制原始数据', exact: true })).toHaveCount(1);
    expect(requests).toHaveLength(0);
    await page.screenshot({ path: `../../.codex-tmp/image-history-${mode}-expanded.png` });
    await page.getByRole('button', { name: 'Theme', exact: true }).click();
    await page.screenshot({ path: `../../.codex-tmp/image-history-${mode}-expanded-dark.png` });
    await tool.click();
    await expect(page.locator('pre, img')).toHaveCount(0);
  });

  test(`${mode}: a single expanded result with many images loads only nearby previews`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const value = history();
    value.activeTurn = null;
    value.turns[0] = { id: 'turn', status: 'completed', items: [{ id: 'tool', type: 'mcpToolCall',
      tool: '截图检查', status: 'completed', result: { content: Array.from({ length: IMAGE_COUNT }, (_, index) =>
        ({ type: 'inputImage', imageUrl: `C:/captures/image-${index}.png` })) } }] };
    const requests = await setup(page, value);
    await page.goto(`/e2e/image-history-harness.html?mode=${mode}`);
    const process = mode === 'local' ? page.locator('summary[data-history-anchor]')
      : page.locator('.chat-desktop-work button');
    await process.click();
    const tool = mode === 'local' ? page.locator('[data-message-id="tool"] > details > summary')
      : page.locator('[data-message-id="tool"] .chat-activity');
    expect(requests).toHaveLength(0);
    await tool.click();
    await expect(page.locator('img').first()).toBeVisible();
    expect(requests.length).toBeLessThan(40);
    expect(await page.locator('img').count()).toBeLessThan(20);
    const last = page.locator('span[data-viewport-content]').last();
    await last.scrollIntoViewIfNeeded();
    await expect(last.locator('img')).toBeVisible();
    expect(await page.locator('img').count()).toBeLessThan(20);
    await page.screenshot({ path: `../../.codex-tmp/image-history-${mode}-tool-images.png` });
    await tool.click();
    await expect(page.locator('img')).toHaveCount(0);
  });
}

test('local: a collapsed plan does not render or read its image explanation', async ({ page }) => {
  const value = history();
  value.activeTurn = null;
  value.turns[0] = { id: 'turn', status: 'completed', items: [],
    plan: [{ step: '检查页面', status: 'completed' }], planExplanation: '![计划截图](/C:/captures/plan.png)' };
  const requests = await setup(page, value);
  await page.goto('/e2e/image-history-harness.html?mode=local');
  const plan = page.locator('details > summary');
  await expect(plan).toContainText('任务计划');
  expect(requests).toHaveLength(0);
  await plan.click();
  await expect(page.locator('img')).toBeVisible();
  expect(requests).toEqual(['C:/captures/plan.png']);
  await plan.click();
  await expect(page.locator('img')).toHaveCount(0);
});
