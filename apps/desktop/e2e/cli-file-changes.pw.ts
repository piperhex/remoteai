import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { timelineEntry } from '../cli-gui/mapping';
import type { CliEntry } from '../../../shared/cli-gui/types';
import type { createCliGuiFixture } from './cli-gui-fixture';
import { localBackend, nativeShell } from './cli-gui-support';

const evidence = resolve('../../.codex-tmp/cli-edit-evidence');
const entries: CliEntry[] = [timelineEntry({ type: 'user_message', text: 'Update the greeting.' }, 1, 1),
  timelineEntry({ type: 'tool_call', callId: 'edit', name: 'Edit', status: 'completed', error: null,
    detail: { type: 'edit', filePath: 'src/greeting.ts', oldString: 'helloBefore', newString: 'helloAfter' } }, 2, 3),
  timelineEntry({ type: 'tool_call', callId: 'write', name: 'Write', status: 'completed', error: null,
    detail: { type: 'write', filePath: 'README.md', content: 'Documentation' } }, 4, 5),
  timelineEntry({ type: 'tool_call', callId: 'denied', name: 'Edit', status: 'canceled', error: null,
    detail: { type: 'edit', filePath: 'denied.ts', oldString: 'old', newString: 'new' } }, 6, 7)];
type FixtureWindow = Window & { cliFixture: ReturnType<typeof createCliGuiFixture> };

for (const mode of ['local', 'remote', 'web']) for (const engine of ['claude', 'gemini'] as const) {
  for (const large of [false, true]) {
    test(`${mode} ${engine}: edited files and review ${large ? 'dark large' : 'default'}`, async ({ page }) => {
      test.setTimeout(180_000);
      page.setDefaultTimeout(10_000);
      page.setDefaultNavigationTimeout(90_000);
      await mkdir(evidence, { recursive: true });
      await page.setViewportSize({ width: large ? 960 : 1440, height: 900 });
      if (mode === 'local') await nativeShell(page);
      const fixture = await localBackend(page);
      const update = async (items: CliEntry[], status: string) => {
        if (mode === 'local') fixture.setHistory(engine, items, status);
        else await page.evaluate(({ engine, items, status }) =>
          (window as FixtureWindow).cliFixture.setHistory(engine, items, status), { engine, items, status });
      };
      await page.goto(`/e2e/cli-gui-harness.html?mode=${mode}&native${large ? '&dark&large' : ''}`);
      await expect(page.locator('.cli-gui-engine:visible')).toBeVisible();
      await update(entries, 'running');
      await page.getByRole('button', { name: engine === 'claude' ? '检查项目结构' : '整理测试计划', exact: true }).click();
      const pane = page.locator('.cli-gui-pane');
      const badge = mode === 'local' ? pane.getByRole('button', { name: /^查看本轮修改：已编辑/ })
        : pane.locator('.chat-changes-pill');
      await expect(badge).toContainText(/已编辑.*2/);
      await badge.click();
      const dialog = page.locator('[data-details-panel]:visible');
      await expect(dialog).toContainText('greeting.ts');
      await expect(dialog).toContainText('helloBefore');
      await expect(dialog).toContainText('helloAfter');
      await expect(dialog).not.toContainText('denied.ts');
      const label = `${mode}-${engine}-${large ? 'dark-large-narrow' : 'light-default'}`;
      await page.screenshot({ path: resolve(evidence, `${label}-running-review.png`), animations: 'disabled' });
      await dialog.press('Escape');
      await update([...entries, timelineEntry({ type: 'assistant_message', text: 'Updated greeting.' }, 8, 8)], 'idle');
      await expect(badge).toHaveCount(0);
      const review = pane.getByRole('button', { name: /查看.*2 个文件/ });
      await expect(review).toBeVisible();
      await expect(pane.getByRole('alert')).toHaveCount(0);
      await page.screenshot({ path: resolve(evidence, `${label}-completed.png`), animations: 'disabled' });
      await review.click();
      await expect(dialog).toContainText('helloAfter');
      await dialog.press('Escape');
      await page.getByRole('button', { name: '查看文件更改', exact: true }).click();
      await expect(dialog).toContainText('greeting.ts');
      expect(fixture.commands.filter(command => command.includes('undo'))).toEqual([]);
    });
  }
}
