import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { localBackend, nativeShell } from './cli-gui-support';

const evidence = resolve('../../.codex-tmp/agent-hub-focus');
async function activateWindow(page: Page, native = false) {
  await page.evaluate(native => {
    if (native) Reflect.get(window, 'emitNativeTestEvent')('tauri://focus', null);
    else window.dispatchEvent(new Event('focus'));
  }, native);
}

for (const mode of ['local', 'remote']) {
  for (const narrow of [false, true]) {
    test(`${mode}: focus on menu entry and app activation ${narrow ? 'narrow dark' : 'default'}`, async ({ page }) => {
      test.setTimeout(180_000);
      page.setDefaultTimeout(15_000);
      await mkdir(evidence, { recursive: true });
      await page.setViewportSize({ width: narrow ? 960 : 1440, height: 900 });
      await nativeShell(page);
      await localBackend(page);
      await page.goto(`/e2e/cli-gui-harness.html?mode=${mode}&native&hub${narrow ? '&large&dark' : ''}`,
        { waitUntil: 'domcontentloaded', timeout: 120_000 });
      const navigation = page.locator('.top-tabs');
      const selector = page.locator('.cli-gui-engine:visible');
      for (const engine of ['Codex GUI', 'Claude GUI', 'Gemini GUI']) {
        if (engine !== 'Codex GUI') {
          await selector.click();
          await page.getByRole('menuitem', { name: engine, exact: true }).click();
        }
        const input = page.locator('[contenteditable=true]:visible, .chat-composer textarea:visible, '
          + 'textarea.cli-gui-input:visible').first();
        await expect(input).toBeVisible();
        await input.fill('保留草稿 Focus draft');
        await navigation.locator('button').nth(2).click();
        const other = page.getByRole('textbox', { name: 'Other page input' });
        await other.fill('Other page');
        await activateWindow(page, true);
        await expect(other).toBeFocused();
        await navigation.getByRole('button', { name: 'Agent Hub', exact: true }).click();
        await expect(input).toBeFocused();
        const prefix = `${mode}-${narrow ? 'dark-large-narrow' : 'light-default'}-${engine.split(' ')[0]}`;
        await page.screenshot({ path: resolve(evidence, `${prefix}-menu.png`), animations: 'disabled' });
        await selector.focus();
        await activateWindow(page, true);
        await expect(input).toBeFocused();
        expect(await input.evaluate(node => node instanceof HTMLTextAreaElement ? node.value : node.textContent))
          .toBe('保留草稿 Focus draft');
        await page.screenshot({ path: resolve(evidence, `${prefix}-activation.png`), animations: 'disabled' });
        await selector.focus();
        await activateWindow(page);
        await expect(input).toBeFocused();
        await selector.click();
        await expect(page.getByRole('menuitem', { name: 'Codex GUI', exact: true })).toBeVisible();
        await activateWindow(page, true);
        await expect(input).not.toBeFocused();
        await page.keyboard.press('Escape');
      }
    });
  }
}
