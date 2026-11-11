import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { localBackend, nativeShell } from './cli-gui-support';

const evidence = resolve('../../.codex-tmp/agent-hub-evidence');
for (const mode of ['local', 'remote', 'web']) {
  for (const large of [false, true]) {
    test(`${mode}: Agent Hub entry and CLI identities ${large ? 'enlarged dark' : 'default'}`, async ({ page }) => {
      test.setTimeout(180_000);
      await mkdir(evidence, { recursive: true });
      await page.setViewportSize({ width: large ? 960 : 1440, height: 900 });
      if (mode === 'local') await nativeShell(page);
      await localBackend(page);
      await page.goto(`/e2e/cli-gui-harness.html?mode=${mode}&native&hub${large ? '&large&dark' : ''}`,
        { waitUntil: 'domcontentloaded' });
      if (mode !== 'web') {
        await expect(page.getByRole('button', { name: 'Agent Hub', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Agent Hub', exact: true })).toBeVisible();
      } else {
        await expect(page.locator('.chat-sidebar-heading strong')).toHaveText('Agent Hub');
        await expect(page.locator('.chat-thread-filter')).toHaveCSS('white-space', 'nowrap');
      }
      const selector = page.locator('.cli-gui-engine:visible');
      for (const engine of ['Codex GUI', 'Claude GUI', 'Gemini GUI']) {
        if (engine !== 'Codex GUI') {
          await selector.click();
          await page.getByRole('menuitem', { name: engine, exact: true }).click();
        }
        await expect(selector).toContainText(engine);
        await expect(selector).toContainText(/\d+\.\d+\.\d+/);
        const root = engine === 'Codex GUI' ? page.locator('.cli-gui-codex-content:visible')
          : page.locator('.cli-gui-pane');
        await expect(root.locator('[contenteditable=true]:visible, textarea:visible').first()).toBeVisible();
        await page.screenshot({ path: resolve(evidence,
          `${mode}-${large ? 'dark-large-narrow' : 'light-default'}-${engine.split(' ')[0]}.png`),
        animations: 'disabled' });
      }
    });
  }
}
