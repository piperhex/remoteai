import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Thread } from '../../../shared/conversation/types';

type Mode = 'local' | 'remote' | 'web';
const COUNT = 39;
const EVIDENCE = '../../.codex-tmp/activity-group-evidence';

function fixture(count = COUNT) {
  const thread: Thread = { id: 'command-limit', cwd: '', preview: '', updatedAt: 1, turns: [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `earlier-${index}`, status: 'completed', items: [
      { id: `question-${index}`, type: 'userMessage', text: `检查任务 ${index + 1} 的执行情况。` },
      { id: `answer-${index}`, type: 'agentMessage', phase: 'final_answer' as const,
        text: `任务 ${index + 1} 已完成，继续检查后续命令。` },
    ] })),
    { id: 'turn', status: 'inProgress', items: [
      { id: 'request', type: 'userMessage', text: '检查连续命令的展开和滚动效果。' },
      { id: 'before', type: 'agentMessage', phase: 'commentary', text: '正在依次检查项目配置。' },
      ...Array.from({ length: count }, (_, index) => ({ id: `command-${index}`, type: 'commandExecution',
        status: index === count - 1 ? 'inProgress' : 'completed',
        command: `npm run check:project-${index + 1}`, aggregatedOutput: `RESULT-${index}\n检查完成。` })),
      { id: 'after', type: 'agentMessage', phase: 'commentary', text: '可以展开命令查看结果，或继续输入消息。' },
    ] },
  ] };
  return { thread, page: { hasMore: false } };
}

async function openGroup(page: Page, mode: Mode, { count = COUNT, dark = false } = {}) {
  await page.route('**/process-history.json', route => route.fulfill({ json: fixture(count) }));
  await page.goto(`/e2e/process-history-harness.html?mode=${mode}${dark ? '&dark' : ''}`);
  const summary = page.locator(mode === 'local' ? '[data-activity-group] > details > summary'
    : '.chat-entry-activities .chat-inline-activity > .chat-activity').first();
  await summary.click();
  const list = page.locator('[data-activity-list]');
  await expect(list).toBeVisible();
  await list.evaluate(node => node.scrollIntoView({ block: 'center' }));
  const rows = list.locator(mode === 'local' ? ':scope > [data-message-id] > details > summary'
    : ':scope > .chat-inline-activity > .chat-activity');
  await expect(rows).toHaveCount(count);
  return { list, rows, summary };
}

async function wheelList(page: Page, list: Locator, delta: number) {
  const box = (await list.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, delta);
}

async function expectFiveRows(list: Locator, rows: Locator) {
  await expect.poll(async () => {
    const box = (await list.boundingBox())!;
    const first = (await rows.first().boundingBox())!;
    const fifth = (await rows.nth(4).boundingBox())!;
    const padding = await list.evaluate(node => {
      const style = getComputedStyle(node);
      return parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    });
    return Math.abs(box.height - (fifth.y + fifth.height - first.y + padding));
  }).toBeLessThan(1);
  await expect(rows.nth(4)).toBeInViewport();
  await expect(rows.nth(5)).not.toBeInViewport();
}

for (const mode of ['local', 'remote', 'web'] as const) {
  for (const appearance of [{ width: 1280, font: 14, dark: false }, { width: 960, font: 20, dark: true }]) {
    test(`${mode} ${appearance.width}px: five visible commands with independent scrolling`, async ({ page }) => {
      await page.setViewportSize({ width: appearance.width, height: 900 });
      await page.addInitScript(font => localStorage.setItem('codex-switch:global-font-size', String(font)),
        appearance.font);
      const { list, rows, summary } = await openGroup(page, mode, { dark: appearance.dark });
      await page.evaluate(({ font, dark }) => {
        document.documentElement.style.setProperty('--gui-font-size', `${font}px`);
        if (dark) document.documentElement.dataset.theme = 'dark';
      }, appearance);
      await list.evaluate(node => node.scrollIntoView({ block: 'center' }));
      await list.evaluate(node => { node.scrollTop = 0; });
      await expectFiveRows(list, rows);
      await expect(list).toHaveCSS('overscroll-behavior-y', 'contain');
      const label = `${mode}-${appearance.width}-${appearance.dark ? 'dark' : 'light'}-font-${appearance.font}`;
      await page.screenshot({ path: `${EVIDENCE}/${label}-expanded.png` });
      const history = page.locator(mode === 'local' ? '[aria-label="对话消息"]' : '.chat-messages');
      const outerTop = await history.evaluate(node => node.scrollTop);
      await wheelList(page, list, 100_000);
      await expect(rows.last()).toBeInViewport();
      await wheelList(page, list, 100_000);
      await expect.poll(() => history.evaluate(node => node.scrollTop)).toBe(outerTop);
      await expect(rows.first()).not.toBeInViewport();
      const height = (await list.boundingBox())!.height;
      await rows.last().click();
      await expect(list).toContainText(`RESULT-${COUNT - 1}`);
      await expect.poll(async () => (await list.boundingBox())!.height).toBeGreaterThan(height);
      await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await expect(list.getByText(`RESULT-${COUNT - 1}`, { exact: false }).last()).toBeInViewport();
      await page.screenshot({ path: `${EVIDENCE}/${label}-last-command.png` });
      await rows.last().click();
      await expect.poll(async () => (await list.boundingBox())!.height).toBeCloseTo(height, 0);
      await list.focus();
      await page.keyboard.press('Home');
      await expect.poll(() => list.evaluate(node => node.scrollTop)).toBe(0);
      const beforeUpWheel = await history.evaluate(node => node.scrollTop);
      await wheelList(page, list, -100_000);
      await expect.poll(() => history.evaluate(node => node.scrollTop)).toBe(beforeUpWheel);
      await expectFiveRows(list, rows);
      await page.getByLabel('消息', { exact: true }).fill('查看命令时继续输入');
      await summary.click();
      await expect(list).toHaveCount(0);
      await summary.click();
      await expect(list).toBeVisible();
      await list.scrollIntoViewIfNeeded();
      await expectFiveRows(list, rows);
      await expect(page.getByLabel('消息', { exact: true })).toHaveValue('查看命令时继续输入');
    });
  }

  for (const count of [3, 5]) {
    test(`${mode}: ${count} commands need no scrollbar`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      const { list, rows } = await openGroup(page, mode, { count });
      await expect(rows.first()).toBeInViewport();
      await expect(rows.last()).toBeInViewport();
      expect(await list.evaluate(node => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
    });
  }
}
