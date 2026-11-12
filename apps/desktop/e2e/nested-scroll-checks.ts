import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Thread } from '../../../shared/conversation/types';

type Mode = 'local' | 'remote' | 'web';
const COUNT = 18;
const EVIDENCE = '../../.codex-tmp/nested-scroll-evidence';

function fixture(): Thread {
  const paragraph = '检查命令执行结果后，可以继续阅读对话。\n\n'.repeat(20);
  return { id: 'nested-scroll', cwd: '', preview: '', updatedAt: 1, turns: [
    { id: 'turn', status: 'inProgress', items: [
      { id: 'before', type: 'agentMessage', phase: 'commentary', text: paragraph },
      ...Array.from({ length: COUNT }, (_, index) => ({ id: `command-${index}`,
        type: 'commandExecution', status: 'completed', command: `inspect-${index}`,
        aggregatedOutput: Array.from({ length: 100 }, (_, line) => `结果 ${line + 1}: 检查完成。`).join('\n') })),
      { id: 'after', type: 'agentMessage', phase: 'commentary', text: paragraph },
    ] },
  ] };
}

async function position(node: Locator, top: number | 'end') {
  await node.evaluate((element, value) => {
    element.scrollTop = value === 'end' ? element.scrollHeight : value;
  }, top);
}

const offset = (node: Locator) => node.evaluate(element => element.scrollTop);
const remaining = (node: Locator) => node.evaluate(element =>
  element.scrollHeight - element.clientHeight - element.scrollTop);

async function wheel(page: Page, node: Locator, deltaY: number) {
  const point = await node.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    let top = Math.max(0, bounds.top);
    let bottom = Math.min(innerHeight, bounds.bottom);
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (!/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(parent).overflowY)) continue;
      const rect = parent.getBoundingClientRect();
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
    }
    return { x: bounds.x + bounds.width / 2, y: (top + bottom) / 2, height: bottom - top };
  });
  expect(point.height).toBeGreaterThan(0);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, deltaY);
}

async function open(page: Page, mode: Mode, dark: boolean) {
  await page.route('**/process-history.json', route => route.fulfill({
    json: { thread: fixture(), page: { hasMore: false } },
  }));
  await page.goto(`e2e/process-history-harness.html?mode=${mode}${dark ? '&dark' : ''}`);
  await page.locator(mode === 'local' ? '[data-activity-group] > details > summary'
    : '.chat-entry-activities .chat-inline-activity > .chat-activity').first().click();
  const list = page.locator('[data-activity-list]');
  const rows = list.locator(mode === 'local' ? ':scope > [data-message-id] > details > summary'
    : ':scope > .chat-inline-activity > .chat-activity');
  await rows.last().click();
  const output = list.locator('.cs-command-output');
  await expect(output).toBeVisible();
  await output.scrollIntoViewIfNeeded();
  await list.evaluate(node => node.scrollIntoView({ block: 'center' }));
  const history = page.locator(mode === 'local' ? '[aria-label="对话消息"]' : '.chat-messages');
  return { history, list, output };
}

export function nestedScrollChecks(modes: Mode[]) {
  for (const mode of modes) for (const width of [1280, 960]) {
    test(`${mode} ${width}px: output hands scrolling to activity then conversation in both directions`,
      async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        const { history, list, output } = await open(page, mode, width === 960);
        await position(output, 0);
        await list.evaluate(node => { node.scrollTop = node.scrollHeight - node.clientHeight - 100; });
        const listStart = await offset(list);
        const historyStart = await offset(history);
        await wheel(page, output, 120);
        await expect.poll(() => offset(output)).toBe(120);
        expect(await offset(list)).toBe(listStart);
        expect(await offset(history)).toBe(historyStart);
        await position(output, 'end');
        await expect.poll(() => remaining(output)).toBeLessThan(2);
        await wheel(page, output, 100);
        await expect.poll(() => remaining(list)).toBeLessThan(2);
        expect(await offset(history)).toBe(historyStart);
        await page.screenshot({ path: `${EVIDENCE}/${mode}-${width}-output-to-activity.png` });
        await wheel(page, output, 120);
        await expect.poll(() => offset(history)).toBe(historyStart + 120);
        expect(await remaining(output)).toBeLessThan(2);
        await page.screenshot({ path: `${EVIDENCE}/${mode}-${width}-activity-to-conversation.png` });

        await position(output, 120);
        const beforeUp = await offset(history);
        const listBeforeUp = await offset(list);
        await wheel(page, output, -60);
        await expect.poll(() => offset(output)).toBe(60);
        expect(await offset(list)).toBe(listBeforeUp);
        expect(await offset(history)).toBe(beforeUp);
        await position(output, 0);
        await wheel(page, output, -120);
        await expect.poll(() => offset(list)).toBeLessThan(listBeforeUp);
        expect(await offset(history)).toBe(beforeUp);
        await position(list, 0);
        await wheel(page, list, -120);
        await expect.poll(() => offset(history)).toBe(beforeUp - 120);
        await page.screenshot({ path: `${EVIDENCE}/${mode}-${width}-upward-to-conversation.png` });
      });
  }
}
