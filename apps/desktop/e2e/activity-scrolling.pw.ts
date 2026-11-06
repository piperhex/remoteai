import { expect, test, type Page } from '@playwright/test';
import type { Conversation } from '../../../shared/conversation/types';

const ACTIVITY_COUNT = 180;
function fixture(): Conversation {
  return { thread: { id: 'activity-scroll', cwd: '', preview: '', updatedAt: 1 },
    activeTurn: 'turn', tokens: 0, error: '', turns: [{ id: 'turn', status: 'inProgress',
      items: Array.from({ length: ACTIVITY_COUNT }, (_, index) => ({ id: `activity-${index}`,
        type: 'agentMessage', phase: 'commentary', text: `正在检查第 ${index} 项活动。` })),
    }] };
}

async function scrollHistory(page: Page, direction: 'older' | 'newer') {
  const viewport = page.getByLabel('对话消息');
  const bounds = (await viewport.boundingBox())!;
  // Use the gutter so the wheel belongs to the conversation, not a nested command output.
  await page.mouse.move(bounds.x + bounds.width - 20, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, direction === 'older' ? -100_000 : 100_000);
  await expect.poll(() => viewport.evaluate((node, direction) => direction === 'older'
    ? node.scrollTop : node.scrollHeight - node.scrollTop - node.clientHeight, direction)).toBeLessThan(2);
}

for (const width of [390, 1280]) {
  test(`expanded process keeps all activities while scrolling and streaming at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.route('**/history-fixture.json', route => route.fulfill({ json: fixture() }));
    await page.goto('/e2e/tool-history-harness.html');
    const rows = page.locator('[data-message-id]');
    await expect(rows).toHaveCount(ACTIVITY_COUNT);
    await scrollHistory(page, 'older');
    await expect(rows.first()).toBeInViewport();
    const viewport = page.getByLabel('对话消息');
    const top = await viewport.evaluate(node => node.scrollTop);
    await page.evaluate(value => window.dispatchEvent(new CustomEvent('conversation-fixture', { detail: value })), {
      ...fixture(), turns: [{ ...fixture().turns[0], items: [...fixture().turns[0].items,
        { id: 'new', type: 'agentMessage', phase: 'commentary', text: '新活动已到达。' }] }],
    });
    await expect(rows).toHaveCount(ACTIVITY_COUNT + 1);
    expect(await viewport.evaluate(node => node.scrollTop)).toBe(top);
    await expect(rows.first()).toBeInViewport();
    await page.getByLabel('消息', { exact: true }).fill('翻阅时可以继续输入');
    await expect(page.getByLabel('消息', { exact: true })).toHaveValue('翻阅时可以继续输入');
    await scrollHistory(page, 'newer');
    await expect(rows.last()).toBeInViewport();
    await scrollHistory(page, 'older');
    const process = page.locator('summary[data-history-anchor]');
    await process.click();
    await expect(rows).toHaveCount(0);
    await process.click();
    await expect(rows).toHaveCount(ACTIVITY_COUNT + 1);
  });

  test(`expanded commands scroll to both ends and unmount when collapsed at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    const value = fixture();
    value.activeTurn = null;
    value.turns[0].status = 'completed';
    value.turns[0].items = Array.from({ length: ACTIVITY_COUNT }, (_, index) => ({ id: `activity-${index}`,
      type: 'commandExecution', status: 'completed', command: `echo ${index}`, aggregatedOutput: `output-${index}` }));
    await page.route('**/history-fixture.json', route => route.fulfill({ json: value }));
    await page.goto('/e2e/tool-history-harness.html');
    const process = page.locator('summary[data-history-anchor]');
    await expect(page.locator('[data-message-id]')).toHaveCount(0);
    await process.click();
    const group = page.locator('[data-activity-group="activity-0"] > details');
    await expect(page.locator('[data-message-id]')).toHaveCount(0);
    await group.locator(':scope > summary').click();
    await expect(page.locator('[data-message-id]')).toHaveCount(ACTIVITY_COUNT);
    const command = page.locator('[data-message-id="activity-150"] > details');
    await command.locator('summary').click();
    await expect(command).toContainText('output-150');
    const list = group.locator('[data-activity-list]');
    await list.evaluate(node => { node.scrollTop = 0; });
    await expect(page.locator('[data-message-id="activity-0"]')).toBeInViewport();
    await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await expect(page.locator('[data-message-id="activity-179"]')).toBeInViewport();
    await expect(command).toHaveAttribute('open');
    await list.evaluate(node => { node.scrollTop = 0; });
    await group.locator(':scope > summary').click();
    await expect(page.locator('[data-message-id], pre')).toHaveCount(0);
    await group.locator(':scope > summary').click();
    await expect(page.locator('[data-message-id]')).toHaveCount(ACTIVITY_COUNT);
    await scrollHistory(page, 'older');
    await process.click();
    await expect(page.locator('[data-message-id], [data-activity-group], pre')).toHaveCount(0);
    await process.click();
    await expect(group).not.toHaveAttribute('open');
    await group.locator(':scope > summary').click();
    await expect(page.locator('[data-message-id]')).toHaveCount(ACTIVITY_COUNT);
    await scrollHistory(page, 'older');
    await page.screenshot({ path: `../../.codex-tmp/activity-scrolling-${width}.png` });
  });
}

test('earlier explanations remain visible beside a collapsed command run', async ({ page }) => {
  const value = fixture();
  value.turns[0].items = [{ id: 'before', type: 'agentMessage', phase: 'commentary', text: '开始检查。' },
    ...Array.from({ length: ACTIVITY_COUNT }, (_, index) => ({ id: `activity-${index}`,
      type: 'commandExecution', status: 'completed', command: `echo ${index}` }))];
  await page.route('**/history-fixture.json', route => route.fulfill({ json: value }));
  await page.goto('/e2e/tool-history-harness.html');
  const group = page.locator('[data-activity-group="activity-0"] > details');
  await expect(page.locator('[data-message-id="before"]')).toBeInViewport();
  await expect(group).not.toHaveAttribute('open');
  await expect(group.locator('summary')).toContainText('echo 179');
});
