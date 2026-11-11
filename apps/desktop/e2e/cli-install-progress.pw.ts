import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { localBackend, nativeShell } from './cli-gui-support';
import type { createCliGuiFixture } from './cli-gui-fixture';
import type { InstallationProgress } from '../../../shared/cli/installProgressTypes';

const evidence = resolve('../../.codex-tmp/cli-install-progress-evidence');
type FixtureWindow = Window & { cliFixture: ReturnType<typeof createCliGuiFixture> };
for (const mode of ['local', 'remote', 'web']) {
  for (const large of [false, true]) {
    test(`${mode}: real byte progress, unknown size and verification ${large ? 'large dark' : 'default'}`,
      async ({ page }) => {
        await mkdir(evidence, { recursive: true });
        await page.setViewportSize(large ? { width: 960, height: 900 } : { width: 1440, height: 980 });
        if (mode === 'local') await nativeShell(page);
        const fixture = await localBackend(page, false, { codexReady: true, manualInstall: true });
        await page.goto(`/e2e/cli-gui-harness.html?mode=${mode}&missing&native&progress${large ? '&large&dark' : ''}`);
        const pane = page.locator('.cli-gui-pane');
        for (const engine of ['claude', 'gemini'] as const) {
          const name = engine === 'claude' ? 'Claude GUI' : 'Gemini GUI';
          await page.locator('.cli-gui-engine:visible').click();
          await page.getByRole('menuitem', { name, exact: true }).click();
          await pane.getByRole('textbox', { name: '消息', exact: true }).fill('下载期间保留的草稿');
          await pane.locator('.cli-gui-setup').getByRole('button', { name: '一键安装', exact: true }).click();
          await expect(pane.locator('[data-install-phase="preparing"]')).toBeVisible();
          const update = async (progress: InstallationProgress) => {
            if (mode === 'local') fixture.setInstallProgress(engine, progress);
            else await page.evaluate(({ engine, progress }) => {
              (window as FixtureWindow).cliFixture.setInstallProgress(engine, progress);
            }, { engine, progress });
          };
          const fileName = `${engine}-installer.tgz`;
          await update({ phase: 'downloading', fileName, downloaded: 8 * 1024 * 1024, total: 32 * 1024 * 1024 });
          await expect(pane.locator('.ant-progress-text')).toHaveText('25%');
          await expect(pane.locator('[data-install-bytes]')).toHaveText('8.0 MB / 32.0 MB');
          await expect(pane.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('下载期间保留的草稿');
          await page.screenshot({ path: resolve(evidence,
            `${mode}-${large ? 'dark-narrow-large' : 'light-default'}-${engine}-downloading.png`) });
          await update({ phase: 'downloading', fileName, downloaded: 24 * 1024 * 1024, total: 32 * 1024 * 1024 });
          await expect(pane.locator('.ant-progress-text')).toHaveText('75%');
          await update({ phase: 'downloading', fileName, downloaded: 4 * 1024 * 1024 });
          await expect(pane.locator('.ant-progress-text')).toHaveCount(0);
          await expect(pane.locator('[data-install-bytes]')).toHaveText('4.0 MB');
          await update({ phase: 'installing', downloaded: 32 * 1024 * 1024, total: 32 * 1024 * 1024 });
          await expect(pane.locator('[data-install-phase="installing"]')).toBeVisible();
          await update({ phase: 'verifying', downloaded: 32 * 1024 * 1024, total: 32 * 1024 * 1024 });
          await expect(pane.locator('[data-install-phase="verifying"]')).toContainText('正在校验');
          await page.screenshot({ path: resolve(evidence,
            `${mode}-${large ? 'dark-narrow-large' : 'light-default'}-${engine}-verifying.png`) });
          if (mode === 'local') fixture.finishInstall(engine);
          else await page.evaluate(engine => (window as FixtureWindow).cliFixture.finishInstall(engine), engine);
          await expect(pane.locator('.cli-gui-setup')).not.toBeVisible();
          await expect(pane.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('下载期间保留的草稿');
        }
      });
  }
}
