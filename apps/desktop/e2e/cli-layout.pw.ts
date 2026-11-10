import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { localBackend, nativeShell } from './cli-gui-support';

const evidence = resolve('../../.codex-tmp/cli-install-composer-evidence');
for (const mode of ['local', 'remote', 'web']) {
  for (const large of [false, true]) {
    test(`${mode}: existing welcome, toolbar and model source ${large ? 'large dark' : 'default'}`, async ({ page }) => {
      await mkdir(evidence, { recursive: true });
      await page.setViewportSize(large ? { width: 960, height: 900 } : { width: 1440, height: 980 });
      if (mode === 'local') await nativeShell(page);
      const fixture = await localBackend(page);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`/e2e/cli-gui-harness.html?mode=${mode}&native${large ? '&large&dark' : ''}`);
      const selector = page.locator('.cli-gui-engine:visible');
      await expect(selector).toContainText('Codex GUI');
      const welcome = page.getByRole('heading', { name: '想一起完成什么？', exact: true });
      await expect(welcome).toBeVisible();
      const baseline = await welcome.boundingBox();
      const toolbar = page.locator('header.workspace-toolbar');
      const tools = await toolbar.getByRole('button').count();
      for (const engine of ['Claude GUI', 'Gemini GUI']) {
        await selector.click();
        await page.getByRole('menuitem', { name: engine, exact: true }).click();
        await expect(welcome).toBeVisible();
        const current = await welcome.boundingBox();
        expect(Math.abs(current!.x - baseline!.x)).toBeLessThan(2);
        expect(Math.abs(current!.y - baseline!.y)).toBeLessThan(2);
        await expect(toolbar.getByRole('button')).toHaveCount(tools);
        await expect(page.locator('.cli-gui-pane button').filter({ hasText: 'GPT-6' })).toBeVisible();
        await page.screenshot({ path: resolve(evidence, `${mode}-${large ? 'dark-narrow' : 'light'}-${engine.split(' ')[0]}-welcome.png`),
          animations: 'disabled' });
      }
      if (mode === 'local') expect(fixture.modelRequests.every(request => request.cacheOnly)).toBe(true);
      else expect(await page.evaluate(() => (window as unknown as { cliModelRequests: { operation: string }[] })
        .cliModelRequests.filter(request => request.operation === 'modelsRefresh'))).toHaveLength(0);
      await page.locator('.cli-gui-pane').getByRole('button', { name: '刷新 CLI 和模型', exact: true }).click();
      if (mode === 'local') await expect.poll(() => fixture.modelRequests.filter(request => !request.cacheOnly).length).toBe(1);
      else await expect.poll(() => page.evaluate(() => (window as unknown as {
        cliModelRequests: { operation: string }[] }).cliModelRequests
        .filter(request => request.operation === 'modelsRefresh').length)).toBe(1);
      await page.locator('.cli-gui-pane [data-project-bar] button[aria-haspopup="menu"]').first().click();
      await page.getByRole('menuitemradio', { name: 'Remote AI', exact: true }).click();
      await toolbar.getByRole('button').last().click();
      const panel = page.locator('[data-details-panel]:visible');
      await expect(panel).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Git', exact: true })).toBeEnabled();
      await expect(panel.getByRole('button', { name: '文件浏览', exact: true })).toBeEnabled();
      await page.screenshot({ path: resolve(evidence, `${mode}-${large ? 'dark-narrow' : 'light'}-tools.png`),
        animations: 'disabled' });
      expect(errors).toEqual([]);
    });
    test(`${mode}: centered installation ${large ? 'large dark' : 'default'}`, async ({ page }) => {
      await mkdir(evidence, { recursive: true });
      await page.setViewportSize(large ? { width: 960, height: 900 } : { width: 1440, height: 980 });
      if (mode === 'local') await nativeShell(page);
      await localBackend(page, false, { codexReady: true });
      const appearance = large ? '&large&dark' : mode === 'web' ? '' : '&skin';
      await page.goto(`/e2e/cli-gui-harness.html?mode=${mode}&missing&native${appearance}`);
      const selector = page.locator('.cli-gui-engine:visible');
      await expect(selector).toContainText('Codex GUI');
      await expect(selector).toContainText('0.150.0');
      const typography = (node: HTMLElement) => ({ font: getComputedStyle(node).fontSize,
        family: getComputedStyle(node).fontFamily, weight: getComputedStyle(node).fontWeight });
      const originalTypography = await selector.evaluate(typography);
      for (const engine of ['Claude GUI', 'Gemini GUI']) {
        await selector.click();
        await page.getByRole('menuitem', { name: engine, exact: true }).click();
        const pane = page.locator('.cli-gui-pane');
        const setup = pane.locator('.cli-gui-setup');
        await expect(setup.getByRole('button', { name: '一键安装', exact: true })).toBeVisible();
        const input = pane.getByRole('textbox', { name: '消息', exact: true });
        await expect(input).toBeVisible();
        await expect(input).toBeEditable();
        await input.fill(`${engine} 安装期间保留的草稿`);
        await expect(pane.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
        expect(await selector.evaluate(typography)).toEqual(originalTypography);
        const bounds = await pane.locator('.cli-gui-install-region').boundingBox();
        const heading = await setup.getByRole('heading', { name: engine, exact: true }).boundingBox();
        expect(Math.abs(heading!.x + heading!.width / 2 - bounds!.x - bounds!.width / 2)).toBeLessThan(2);
        expect(Math.abs(heading!.y + heading!.height / 2 - bounds!.y - bounds!.height / 2)).toBeLessThan(65);
        await expect(page.locator('header.workspace-toolbar').getByRole('button').last()).toBeVisible();
        await page.screenshot({ path: resolve(evidence,
          `${mode}-${large ? 'dark-narrow' : 'light'}-${engine.split(' ')[0]}-center-install.png`), animations: 'disabled' });
        await setup.getByRole('button', { name: '一键安装', exact: true }).click();
        await expect(setup.getByRole('status')).toBeVisible();
        await expect(input).toBeVisible();
        await expect(input).toHaveValue(`${engine} 安装期间保留的草稿`);
        expect(await selector.evaluate(typography)).toEqual(originalTypography);
        await page.screenshot({ path: resolve(evidence,
          `${mode}-${large ? 'dark-narrow' : 'light'}-${engine.split(' ')[0]}-installing-composer.png`),
          animations: 'disabled' });
        await expect(setup).not.toBeVisible({ timeout: 10_000 });
        await expect(input).toHaveValue(`${engine} 安装期间保留的草稿`);
        expect(await selector.evaluate(typography)).toEqual(originalTypography);
      }
    });
  }
}

for (const mode of ['local', 'remote']) {
  test(`${mode}: keeps the selected wallpaper and composer surface`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    if (mode === 'local') await nativeShell(page);
    await localBackend(page);
    await page.goto(`/e2e/cli-gui-harness.html?mode=${mode}&native&skin`);
    const skin = page.locator('[data-dream-skin=true]');
    await expect(skin).toBeVisible();
    const style = await skin.evaluate(node => getComputedStyle(node).backgroundImage);
    const composer = page.locator(mode === 'local'
      ? '[class*="composer_"]:has([contenteditable=true]):visible' : '.chat-composer:visible').first();
    const baseline = await composer.evaluate(node => getComputedStyle(node).backgroundColor);
    await page.locator('.cli-gui-engine:visible').click();
    await page.getByRole('menuitem', { name: 'Claude GUI', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible();
    expect(await skin.evaluate(node => getComputedStyle(node).backgroundImage)).toBe(style);
    expect(await page.locator('.cli-gui-pane textarea').evaluate(node =>
      getComputedStyle(node.closest('[class*="composer_"]')!).backgroundColor)).toBe(baseline);
    await page.screenshot({ path: resolve(evidence, `${mode}-wallpaper-claude.png`), animations: 'disabled' });
  });
}
