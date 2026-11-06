import { expect, test } from '@playwright/test';
import type { Thread } from '../../../shared/conversation/types';

const source: Thread = { id: 'process-history', cwd: '', preview: '', updatedAt: 0,
  turns: Array.from({ length: 8 }, (_, turn) => ({ id: `turn-${turn}`, status: 'completed', items: [
    { id: `question-${turn}`, type: 'userMessage', content: [{ type: 'text', text: `请检查第 ${turn} 个任务。` }] },
    ...Array.from({ length: 2_000 }, (_, index) => ({ id: `work-${turn}-${index}`, type: 'agentMessage',
      phase: 'commentary' as const, text: `任务 ${turn} 的处理记录 ${index}：检查完成。` })),
    { id: `command-${turn}`, type: 'commandExecution', status: 'completed',
      command: '检查配置', aggregatedOutput: '命令的完整输出，仅在打开命令后加载。' },
    { id: `answer-${turn}`, type: 'agentMessage', phase: 'final_answer', text: `第 ${turn} 个任务已完成。` },
  ] })) };

// The browser receives only the wire summary. Full activities exist solely in the expansion route.
const summaries = source.turns!.flatMap(turn => [turn.items[0], {
  id: turn.items[1].id, type: 'processSummary', activityCount: 2_001,
  processRef: { threadId: source.id, turnId: turn.id,
    itemId: turn.items[1].id, endItemId: turn.items.at(-2)!.id },
}, turn.items.at(-1)!].map(item => ({ turnId: turn.id, item })));

function historyPage(cursor: string | null) {
  const previous = cursor ? JSON.parse(cursor) as { itemId: string } : undefined;
  const anchor = previous ? summaries.findIndex(entry => entry.item.id === previous.itemId) : summaries.length;
  const start = Math.max(0, anchor - 10);
  const selected = summaries.slice(start);
  const turns = source.turns!.flatMap(turn => {
    const items = selected.filter(entry => entry.turnId === turn.id).map(entry => entry.item);
    return items.length ? [{ ...turn, items }] : [];
  });
  return { thread: { ...source, turns }, page: { hasMore: start > 0,
    start: { turnId: selected[0].turnId, itemId: selected[0].item.id } } };
}

export function processHistoryChecks(modes: string[]) {
  for (const mode of modes) for (const width of [1280, 960]) {
    test(`${mode} ${width}: folded processes skip internal pages and expand all rows on demand`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      let details = 0;
      let tools = 0;
      let pages = 0;
      await page.route('**/process-history.json*', route => {
        pages++;
        const cursor = new URL(route.request().url()).searchParams.get('cursor');
        return route.fulfill({ json: historyPage(cursor) });
      });
      await page.route('**/process-details.json*', async route => {
        details++;
        const query = new URL(route.request().url()).searchParams;
        const turn = source.turns!.find(turn => turn.id === query.get('turnId'))!;
        const items = turn.items.slice(1, -1).map(item => item.type === 'commandExecution'
          ? { id: item.id, type: item.type, status: item.status, commandPreview: '检查配置',
            detailsRef: { threadId: source.id, turnId: turn.id, itemId: item.id } } : item);
        await route.fulfill({ json: { items } });
      });
      await page.route('**/tool-details.json*', route => {
        tools++;
        const id = new URL(route.request().url()).searchParams.get('itemId');
        const item = source.turns!.flatMap(turn => turn.items).find(item => item.id === id)!;
        return route.fulfill({ json: { item } });
      });
      const dark = width === 960;
      const label = `${mode}-${width}-${dark ? 'dark' : 'light'}`;
      await page.goto(`e2e/process-history-harness.html?mode=${mode}${dark ? '&dark' : ''}`);
      await expect(page.getByText('第 7 个任务已完成。', { exact: true })).toBeVisible();
      const viewport = page.locator(mode === 'local' ? '[aria-label="对话消息"]' : '.chat-messages');
      for (let batch = 0; batch < 4; batch++) {
        await viewport.hover(); await page.mouse.wheel(0, -4_000);
        await page.waitForTimeout(180);
      }
      await expect(page.getByText('请检查第 0 个任务。', { exact: true })).toBeVisible();
      expect(pages).toBeLessThanOrEqual(3);
      expect(details).toBe(0);
      await expect(page.getByText(/处理记录/)).toHaveCount(0);
      await page.screenshot({ path: `../../.codex-tmp/process-history-evidence/${label}-collapsed.png` });
      const process = page.locator(mode === 'local' ? '[data-turn-id="turn-0"] > details > summary'
        : '[data-message-id="turn-0:work:work-0-0"] button');
      await process.click();
      await expect(page.getByText('任务 0 的处理记录 1999：检查完成。', { exact: true })).toHaveCount(1);
      expect(details).toBe(1);
      expect(tools).toBe(0);
      await expect(page.getByText('命令的完整输出，仅在打开命令后加载。', { exact: true })).toHaveCount(0);
      await expect(mode === 'local' ? page.locator('[data-message-id^="work-0-"]')
        : page.getByText(/任务 0 的处理记录/)).toHaveCount(2_000);
      await page.getByLabel('消息', { exact: true }).fill('展开后仍可输入');
      await expect(page.getByLabel('消息', { exact: true })).toHaveValue('展开后仍可输入');
      await process.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `../../.codex-tmp/process-history-evidence/${label}-expanded.png` });
      const command = page.locator(mode === 'local' ? 'summary' : 'button').filter({ hasText: '检查配置' });
      await command.scrollIntoViewIfNeeded();
      await expect(page.getByText('任务 0 的处理记录 1999：检查完成。', { exact: true })).toBeVisible();
      await page.screenshot({ path: `../../.codex-tmp/process-history-evidence/${label}-nested-folded.png` });
      await command.click();
      await expect(page.getByText('命令的完整输出，仅在打开命令后加载。', { exact: true })).toBeVisible();
      expect(tools).toBe(1);
      await process.scrollIntoViewIfNeeded();
      await process.click();
      await expect(page.getByText(/处理记录/)).toHaveCount(0);
      const stable = pages;
      await viewport.hover(); await page.mouse.wheel(0, -4_000);
      await page.waitForTimeout(250);
      expect(pages).toBe(stable); expect(details).toBe(1);
    });
  }
}
