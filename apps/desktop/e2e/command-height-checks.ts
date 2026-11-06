import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Item, Thread } from '../../../shared/conversation/types';

type Mode = 'local' | 'remote' | 'web';
const OUTPUT = Array.from({ length: 120 }, (_, index) => `LINE_${index}: complete command output`).join('\n');
const EVIDENCE = '../../.codex-tmp/command-height-evidence';

function fixture(count: number): Thread {
  const items: Item[] = Array.from({ length: count }, (_, index) => ({
    id: `command-${index}`, type: 'commandExecution', status: 'completed', commandPreview: `inspect-${index}`,
    detailsRef: { threadId: 'command-height', turnId: 'turn', itemId: `command-${index}` },
  }));
  return { id: 'command-height', cwd: '', preview: '', updatedAt: 1,
    turns: [{ id: 'turn', status: 'completed', items }] };
}

async function openCommands(page: Page, mode: Mode, count: number, dark: boolean) {
  await page.route('**/process-history.json', route => route.fulfill({
    json: { thread: fixture(count), page: { hasMore: false } },
  }));
  await page.route('**/tool-details.json*', async route => {
    const id = new URL(route.request().url()).searchParams.get('itemId')!;
    await new Promise(resolve => setTimeout(resolve, 100));
    await route.fulfill({ json: { item: { id, type: 'commandExecution', status: 'completed',
      command: `inspect-${id.split('-').at(-1)}`, aggregatedOutput: OUTPUT, exitCode: 0 } } });
  });
  await page.goto(`e2e/process-history-harness.html?mode=${mode}${dark ? '&dark' : ''}`);
  await page.locator(mode === 'local' ? 'summary[data-history-anchor]' : '.chat-desktop-work button').click();
  await page.locator(mode === 'local' ? '[data-activity-group] > details > summary'
    : '.chat-entry-activities .chat-inline-activity > .chat-activity').first().click();
  const list = page.locator('[data-activity-list]');
  const rows = list.locator(mode === 'local' ? ':scope > [data-message-id] > details > summary'
    : ':scope > .chat-inline-activity > .chat-activity');
  await expect(rows).toHaveCount(count);
  return { list, rows };
}

async function expectOutputUnclipped(output: Locator) {
  await expect.poll(() => output.evaluate(node => {
    const bounds = node.getBoundingClientRect();
    let visibleTop = 0;
    let visibleBottom = window.innerHeight;
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (!/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(parent).overflowY)) continue;
      const rect = parent.getBoundingClientRect();
      visibleTop = Math.max(visibleTop, rect.top + parent.clientTop);
      visibleBottom = Math.min(visibleBottom, rect.top + parent.clientTop + parent.clientHeight);
    }
    return Math.max(0, bounds.bottom - visibleBottom, visibleTop - bounds.top);
  })).toBeLessThan(2);
}

export function commandHeightChecks(modes: Mode[]) {
  for (const mode of modes) for (const count of [3, 39]) {
    for (const appearance of [{ width: 1280, font: 14, dark: false }, { width: 960, font: 20, dark: true }]) {
      test(`${mode} ${count} historical commands at ${appearance.width}px: expanded output fits`, async ({ page }) => {
        await page.setViewportSize({ width: appearance.width, height: 1000 });
        await page.addInitScript(font => localStorage.setItem('codex-switch:global-font-size', String(font)),
          appearance.font);
        const { list, rows } = await openCommands(page, mode, count, appearance.dark);
        const label = `${mode}-${count}-${appearance.width}-font-${appearance.font}`;
        await expect(list).toBeVisible();
        const foldedHeight = (await list.boundingBox())!.height;
        const target = count > 5 ? rows.last() : rows.first();
        await target.click();
        const output = list.locator('.cs-command-output');
        await expect(output.locator('.cs-command-result')).toHaveText(OUTPUT);
        await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
        await output.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${EVIDENCE}/${label}-expanded.png` });
        await expectOutputUnclipped(output);
        expect((await list.boundingBox())!.height).toBeGreaterThan(foldedHeight + 200);
        await output.hover();
        await page.mouse.wheel(0, 100_000);
        await expect.poll(() => output.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop))
          .toBeLessThan(2);
        await page.screenshot({ path: `${EVIDENCE}/${label}-output-end.png` });
        await target.click();
        await expect(output).toHaveCount(0);
        await expect.poll(async () => (await list.boundingBox())!.height).toBeCloseTo(foldedHeight, 0);
        await list.evaluate(node => { node.scrollTop = 0; });
        await list.scrollIntoViewIfNeeded();
        await expect(rows.first()).toBeInViewport();
        if (count > 5) await expect(rows.nth(5)).not.toBeInViewport();
        else expect(await list.evaluate(node => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
      });
    }
  }
}
