import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { localBackend, nativeShell } from './cli-gui-support';
import { runningFixtureThreads } from './running-conversations-fixture';

const evidence = resolve('../../.codex-tmp/running-conversations');
for (const mode of ['local', 'remote', 'web']) {
  for (const enlarged of [false, true]) {
    test(`${mode}: ${enlarged ? 'dark enlarged narrow' : 'light default'} running list`, async ({ page }) => {
      await mkdir(evidence, { recursive: true });
      await page.setViewportSize({ width: enlarged ? 960 : 1440, height: 900 });
      const threads = runningFixtureThreads();
      await localBackend(page, true, { threads });
      if (mode === 'local') await nativeShell(page);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`/e2e/cli-gui-harness.html?mode=${mode}&running${mode === 'local' ? '&native' : ''}`
        + (enlarged ? '&large&dark' : ''));
      const panel = page.locator('[data-running-conversations]');
      const list = panel.locator('[data-running-conversations-list]');
      const rows = list.getByRole('button');
      await expect(rows).toHaveCount(8);
      const dimensions = await list.evaluate(node => ({ height: node.clientHeight, scroll: node.scrollHeight,
        row: node.firstElementChild!.getBoundingClientRect().height }));
      expect(dimensions.height).toBeCloseTo(5 * dimensions.row, 0);
      expect(dimensions.scroll).toBeGreaterThan(dimensions.height);
      const label = `${mode}-${enlarged ? 'dark-20px-960' : 'light-14px-1440'}`;
      await page.screenshot({ path: resolve(evidence, `${label}-expanded.png`) });
      await panel.getByRole('button', { name: '收起对话列表', exact: true }).click();
      await expect(list).toHaveCount(0);
      expect((await panel.boundingBox())!.width).toBeLessThan(65);
      await page.screenshot({ path: resolve(evidence, `${label}-collapsed.png`) });
      await panel.getByRole('button', { name: '展开对话列表', exact: true }).click();
      await page.evaluate(() => (window as unknown as {
        archiveRunningConversations(): void;
      }).archiveRunningConversations());
      await expect(rows).toHaveCount(8);
      await rows.last().scrollIntoViewIfNeeded();
      expect(await list.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
      await rows.last().click();
      await expect(page.locator(mode === 'local' ? '.workspace-toolbar > div > strong' : '.chat-header h2'))
        .toHaveText(threads[7].name!);
      await expect(rows.last()).toHaveAttribute('aria-current', 'page');
      expect(await page.evaluate(() => (window as unknown as {
        runningConversationArchived(): boolean;
      }).runningConversationArchived())).toBe(false);
      await expect(page.locator('.chat-error')).toHaveCount(0);
      expect(await rows.last().evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
      await page.screenshot({ path: resolve(evidence, `${label}-scrolled-selected.png`) });
      const finish = async (count: number) => {
        threads.slice(0, count).forEach(thread => {
          thread.status = { type: 'idle' };
          thread.turns = thread.turns!.map(turn => ({ ...turn, status: 'completed' }));
        });
        await page.evaluate(({ mode, count, threads }) => {
          const fixture = window as unknown as {
            finishRunningConversations(count: number): void;
            emitNativeTestEvent(name: string, payload: unknown): void;
          };
          if (mode !== 'local') fixture.finishRunningConversations(count);
          else threads.slice(0, count).forEach(thread => fixture.emitNativeTestEvent('codex-gui-event', {
            method: 'turn/completed', params: { threadId: thread.id, turn: thread.turns![0] },
          }));
        }, { mode, count, threads });
      };
      await finish(3);
      await expect(rows).toHaveCount(5);
      expect(await list.evaluate(node => node.scrollHeight - node.clientHeight)).toBe(0);
      await finish(8);
      await expect(panel).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
}
