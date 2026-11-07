import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Item, Thread } from '../../../shared/conversation/types';

type Mode = 'local' | 'remote' | 'web';
const SCRIPT = 'git -C F:/projects/remoteai diff -- apps/desktop/src/pages/codexGui/'
  + 'ActivityRow.module.less shared/conversation/activityGroups.ts shared/chat/commandPreview.ts';
const COMMAND = '"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -Command '
  + `"${SCRIPT}"`;
const OUTPUT = 'Command output remains complete.\n' + 'verified\n'.repeat(100);
const commands = (start: number, count: number): Item[] => Array.from({ length: count }, (_, offset): Item[] => {
  const index = start + offset;
  return [
    ...Array.from({ length: index % 4 + 1 }, (_, part): Item => ({ id: `empty-${index}-${part}`,
      type: 'reasoning', summary: part % 2 ? [' ', '\n'] : [], content: [] })),
    { id: `comment-${index}`, type: 'agentMessage', phase: 'commentary', text: ' \n ' },
    { id: `cmd-${index}`, type: 'commandExecution', status: 'completed',
      command: COMMAND, aggregatedOutput: OUTPUT, exitCode: 0 },
  ];
}).flat();
const source: Thread = { id: 'command-groups', cwd: '', preview: '', updatedAt: 1,
  turns: [{ id: 'turn', status: 'completed', items: [
    { id: 'before', type: 'agentMessage', phase: 'commentary', text: '开始检查命令显示。' },
    ...commands(0, 3),
    { id: 'between', type: 'agentMessage', phase: 'commentary', text: '接着检查历史输出。' },
    ...commands(3, 8),
    { id: 'visible-reason', type: 'reasoning', summary: ['保留可见的思考内容。'] },
    { id: 'image', type: 'imageView', path: 'F:/projects/remoteai/result.png' },
    { id: 'after', type: 'agentMessage', phase: 'final_answer', text: '命令检查完成。' },
  ] }] };

async function expectCompactRows(rows: Locator) {
  const bounds = await rows.evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  }));
  for (let index = 1; index < bounds.length; index++) {
    expect(bounds[index].top - bounds[index - 1].bottom).toBeGreaterThanOrEqual(-1);
    expect(bounds[index].top - bounds[index - 1].bottom).toBeLessThanOrEqual(16);
  }
}

async function openHistory(page: Page, mode: Mode, dark: boolean) {
  const items = source.turns![0].items;
  const folded = { ...source, turns: [{ ...source.turns![0], items: [
    { id: 'before', type: 'processSummary', activityCount: 15,
      processRef: { threadId: source.id, turnId: 'turn', itemId: 'before', endItemId: 'image' } },
    items.at(-1)!,
  ] }] };
  await page.route('**/process-history.json', route => route.fulfill({ json: {
    thread: folded, page: { hasMore: false },
  } }));
  await page.route('**/process-details.json*', route => route.fulfill({ json: {
    items: items.slice(0, -1).map(item => item.type === 'commandExecution'
      ? { id: item.id, type: item.type, status: item.status, commandPreview: COMMAND,
        detailsRef: { threadId: source.id, turnId: 'turn', itemId: item.id } } : item),
  } }));
  await page.route('**/tool-details.json*', route => route.fulfill({ json: {
    item: source.turns![0].items.find(item => item.id === new URL(route.request().url()).searchParams.get('itemId')),
  } }));
  await page.goto(`e2e/process-history-harness.html?mode=${mode}${dark ? '&dark' : ''}`);
  await page.locator(mode === 'local' ? 'summary[data-history-anchor]' : '.chat-desktop-work button').click();
  return page.locator(mode === 'local' ? '[data-activity-group] > details > summary'
    : '.chat-entry-process .chat-activity[aria-label]');
}

export function commandGroupHistoryChecks(modes: Mode[]) {
  for (const mode of modes) for (const appearance of [
    { width: 1480, font: 14, dark: false }, { width: 960, font: 20, dark: true },
  ]) test(`${mode} ${appearance.width}: deferred command groups ignore hidden rows and fill their preview`,
    async ({ page }) => {
      await page.setViewportSize({ width: appearance.width, height: 1000 });
      await page.addInitScript(font => localStorage.setItem('codex-switch:global-font-size', String(font)),
        appearance.font);
      const groups = await openHistory(page, mode, appearance.dark);
      await expect(groups).toHaveCount(2);
      await expect(page.locator('[data-message-id^="empty-"], [data-message-id^="comment-"]')).toHaveCount(0);
      await expect(page.getByText('开始检查命令显示。', { exact: true })).toBeVisible();
      await expect(page.getByText('接着检查历史输出。', { exact: true })).toBeVisible();
      await expect(page.getByText('保留可见的思考内容。', { exact: true })).toBeVisible();
      const label = `${mode}-${appearance.dark ? 'dark' : 'light'}-${appearance.width}-font-${appearance.font}`;
      await page.screenshot({ path: `../../.codex-tmp/command-group-history-evidence/${label}-collapsed.png` });
      await expect(groups.first()).toContainText(SCRIPT);
      await groups.first().click();
      const list = page.locator('[data-activity-list]');
      const rows = list.locator(mode === 'local' ? ':scope > [data-message-id]' : ':scope > .chat-inline-activity');
      await expect(rows).toHaveCount(3);
      await expectCompactRows(rows);
      const preview = groups.first().locator(mode === 'local' ? 'span' : '.chat-activity-text');
      await expect(preview).toHaveCSS('text-overflow', 'ellipsis');
      if (appearance.font === 20) {
        expect(await preview.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThan(17);
      }
      await rows.first().locator(mode === 'local' ? 'summary' : '.chat-activity').click();
      await expect(list.locator('.cs-command-result')).toHaveText(OUTPUT);
      await expect(list.locator('.cs-command-input code')).toHaveText(COMMAND);
      await page.getByLabel('消息', { exact: true }).fill('查看历史时继续输入');
      await page.screenshot({ path: `../../.codex-tmp/command-group-history-evidence/${label}-output.png` });
      await rows.first().locator(mode === 'local' ? 'summary' : '.chat-activity').click();
      await expectCompactRows(rows);
      await groups.first().click();
      await groups.last().click();
      await expect(rows).toHaveCount(8);
      await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await expect(rows.last()).toBeInViewport();
      await expectCompactRows(rows);
      await page.screenshot({ path: `../../.codex-tmp/command-group-history-evidence/${label}-history.png` });
    });
}
