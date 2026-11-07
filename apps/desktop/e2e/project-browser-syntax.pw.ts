import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import type { BrowserHostMessage, BrowserSettings } from '../../../shared/project-browser/nativeBridge';
import { browserRequest, browserRoot } from './project-browser-fixture';

const require = createRequire(import.meta.url);
const { handleBrowserRequest } = require('../../../shared/project-browser/nativeBridge') as
  typeof import('../../../shared/project-browser/nativeBridge');
const { createProjectBrowserClient } = require('../../../shared/project-browser/protocol') as
  typeof import('../../../shared/project-browser/protocol');

async function watchSyntax(page: Page) {
  await expect(page.locator('.cm-line span[class]').first()).toBeVisible();
  await expect(page.locator('.cm-foldGutter span:visible').first()).toBeVisible();
  await page.evaluate(() => {
    const host = document.querySelector('.pf-editor-host')!;
    const state = { updates: 0, lostSyntax: 0 };
    Object.assign(window, { syntaxStability: state });
    new MutationObserver(() => {
      state.updates += 1;
      const folds = [...host.querySelectorAll('.cm-foldGutter span')]
        .some(marker => getComputedStyle(marker).visibility !== 'hidden');
      if (!host.querySelector('.cm-line span[class]') || !folds) {
        state.lostSyntax += 1;
      }
    }).observe(host, { childList: true, subtree: true });
  });
}

async function checkSyntax(page: Page, mode: string) {
  const stability = await page.evaluate(() => (window as unknown as {
    syntaxStability: { lostSyntax: number };
  }).syntaxStability);
  expect(stability.lostSyntax).toBe(0);
  await page.screenshot({ path: `../../.codex-tmp/mobile-file-preview/${mode}-yaml.png` });
  await page.getByRole('button', { name: '全部折叠', exact: true }).click();
  await expect(page.locator('.cm-foldPlaceholder').first()).toBeVisible();
  await page.screenshot({ path: `../../.codex-tmp/mobile-file-preview/${mode}-folded.png` });
  await page.getByRole('button', { name: '全部展开', exact: true }).click();
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(0);
}

for (const mode of ['local', 'remote', 'web', 'mobile']) {
  test(`${mode}: YAML syntax and folding survive host status updates`, async ({ page }) => {
    await page.setViewportSize(mode === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    await page.goto(`/e2e/project-browser-harness.html?mode=${mode}&dark`);
    if (mode === 'mobile') await page.getByRole('button', { name: '打开工具', exact: true }).click();
    await page.getByRole('button', { name: '文件浏览', exact: true }).click();
    await page.getByRole('treeitem', { name: 'docker-compose.yml', exact: true }).click();
    await watchSyntax(page);
    for (let update = 0; update < 10; update += 1) {
      await page.getByRole('button', { name: '切换连接', exact: true }).evaluate(button => button.click());
      await page.waitForTimeout(50);
    }
    await checkSyntax(page, mode);
  });
}

test('native offline bundle: repeated settings keep YAML syntax and folding', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  const html = readFileSync(new URL('../../native/assets/project-browser.html', import.meta.url), 'utf8');
  const client = createProjectBrowserClient(browserRequest);
  const settings: BrowserSettings = { type: 'settings', cwd: browserRoot, connected: true,
    labels: {}, language: 'zh', autoSaveDelay: 0, themeMode: 'dark',
    theme: { '--ink': '#e6e8eb', '--panel': '#1b201e', '--muted': '#a2aaa7',
      '--bg': '#121614', '--line': '#35413a', '--green': '#61d6ad' } };
  const emit = (message: BrowserHostMessage) => page.evaluate(value => window.projectBrowserMessage(value), message);
  await page.exposeFunction('nativeBrowserRequest', async (raw: string) => {
    const message = JSON.parse(raw) as { type: string };
    if (message.type === 'ready') { await emit(settings); return; }
    const reply = await handleBrowserRequest(raw, { client, cwd: browserRoot, connected: true });
    if (reply) await emit(reply);
  });
  await page.addInitScript(() => {
    window.ReactNativeWebView = { postMessage: message => { void window.nativeBrowserRequest(message); } };
  });
  await page.route('**/native-syntax.html', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('/native-syntax.html');
  await page.getByRole('treeitem', { name: 'docker-compose.yml', exact: true }).click();
  await watchSyntax(page);
  for (let update = 0; update < 20; update += 1) {
    await emit({ ...settings, connected: update % 2 !== 0 });
    await page.waitForTimeout(50);
  }
  await checkSyntax(page, 'native-bundle');
});
