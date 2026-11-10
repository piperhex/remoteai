import { expect, test, type Route } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { localBackend, nativeShell } from './cli-gui-support';

const evidence = resolve('../../.codex-tmp/cli-install-progress-evidence');
for (const mode of ['local', 'remote', 'web']) {
  for (const large of [false, true]) {
    test(`${mode}: Codex download percentage and bytes ${large ? 'large dark' : 'default'}`, async ({ page }) => {
      await mkdir(evidence, { recursive: true });
      await page.setViewportSize(large ? { width: 960, height: 900 } : { width: 1440, height: 980 });
      if (mode === 'local') await nativeShell(page);
      await localBackend(page, false);
      let pending: Route | undefined;
      if (mode === 'local') await page.route('**/__codex_switch__/api/invoke', async route => {
        const { command } = route.request().postDataJSON();
        if (command === 'codex_gui_cli_release' || command === 'codex_gui_cli_check') {
          await route.fulfill({ json: { ok: true, result: { version: '0.151.0', size: 32 * 1024 * 1024 } } });
        } else if (command === 'codex_gui_cli_install') pending = route;
        else await route.fallback();
      });
      await page.goto(`/e2e/cli-gui-harness.html?mode=${mode}&native&codex-progress${large ? '&large&dark' : ''}`);
      if (mode === 'local') {
        await page.getByRole('button', { name: /0\.151\.0/ }).click();
        await expect(page.locator('[data-install-phase="preparing"]')).toBeVisible();
        await page.evaluate(() => {
          const shell = window as Window & { emitNativeTestEvent: (name: string, value: unknown) => void };
          shell.emitNativeTestEvent('codex-gui-download', {
            downloaded: 8 * 1024 * 1024, total: 32 * 1024 * 1024, phase: 'downloading',
          });
        });
      } else await page.getByRole('button', { name: '远程 Codex CLI 更新', exact: true }).click();
      const progress = page.locator('[data-install-phase="downloading"]:visible');
      await expect(progress.locator('.ant-progress-text')).toHaveText('25%');
      await expect(progress.locator('[data-install-bytes]')).toHaveText('8.0 MB / 32.0 MB');
      await page.screenshot({ path: resolve(evidence,
        `${mode}-${large ? 'dark-narrow-large' : 'light-default'}-codex-downloading.png`), animations: 'disabled' });
      await pending?.fulfill({ json: { ok: true, result: { version: '0.151.0' } } });
    });
  }
}
