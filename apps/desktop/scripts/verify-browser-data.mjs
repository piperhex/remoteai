import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

const native = process.argv.includes('--native');
const output = fileURLToPath(new URL('../../../.codex-tmp/browser-data/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = native ? await chromium.connectOverCDP('http://127.0.0.1:9355')
  : await chromium.launch({ ...testBrowserLaunchOptions(), headless: true });
const runs = native ? [['local', 1280, 860, 14, false], ['remote', 900, 760, 20, true]]
  : [['web', 390, 844, 14, false], ['web', 320, 568, 20, true],
    ['web', 1280, 860, 14, false], ['web', 900, 760, 20, true]];
const results = [];
for (const [mode, width, height, font, dark] of runs) {
  const context = native ? browser.contexts()[0] : await browser.newContext({ viewport: { width, height },
    locale: 'zh-CN', isMobile: width < 600, hasTouch: width < 600 });
  const page = native ? context.pages().find(page => page.url().includes('browser-data-harness')) : await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const prefix = `${native ? 'pc' : width < 600 ? 'mobile' : 'desktop'}-${mode}-${dark ? 'dark' : 'light'}-${font}px`;
  const shot = async name => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${output}/${prefix}-${name}.png`, fullPage: true });
  };
  const settings = async () => page.getByRole('button', { name: '浏览器设置', exact: true }).click();
  const open = async label => { await settings(); await page.getByRole('button', { name: label, exact: true }).click(); };
  const close = async () => {
    await page.waitForTimeout(350);
    const count = await page.locator('.ant-modal-wrap:visible').count();
    const dialog = page.locator('.ant-modal-wrap:visible').last();
    await dialog.locator('.ant-modal-close').click();
    await expect(page.locator('.ant-modal-wrap:visible')).toHaveCount(count - 1);
  };
  try {
    if (native) {
      await page.evaluate(mode => localStorage.removeItem(`remoteai:browser-data:browser-data-${mode}`), mode);
    }
    await page.goto(`http://127.0.0.1:1572/e2e/browser-data-harness.html?mode=${mode}&font=${font}${dark ? '&dark' : ''}`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    if (native) await page.setViewportSize({ width, height });
    await settings(); await shot('settings');
    await page.getByRole('button', { name: '历史记录', exact: true }).click();
    await expect(page.locator('.browser-data-row')).toHaveCount(4); await shot('history');
    const search = page.getByRole('textbox', { name: '搜索历史记录' });
    await search.fill('开发'); await expect(page.locator('.browser-data-row')).toHaveCount(1); await shot('history-search');
    await search.fill('');
    await page.getByRole('button', { name: '删除浏览数据', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: '标签页', exact: true })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: '已保存的密码', exact: true })).not.toBeChecked();
    await shot('clear-data');
    const overflow = await page.locator('.ant-modal-wrap:visible .ant-modal-content').last().evaluate(element =>
      element.scrollWidth > element.clientWidth + 1);
    assert.equal(overflow, false, 'Dialog must not overflow horizontally');
    await close(); await close();
    await open('密码管理');
    await shot('passwords-locked');
    await page.getByLabel('密码库口令', { exact: true }).fill('browser-test-passphrase');
    await page.getByRole('button', { name: '解锁密码库', exact: true }).click();
    await expect(page.locator('.browser-password-row')).toHaveCount(1); await shot('passwords');
    await page.getByRole('button', { name: '编辑密码', exact: true }).click();
    await expect(page.getByLabel('密码', { exact: true })).toHaveAttribute('type', 'password');
    await page.getByLabel('用户名', { exact: true }).fill('updated@example.com');
    await shot('password-edit');
    await page.getByRole('button', { name: /保\s*存/ }).click();
    await expect(page.locator('.browser-password-row')).toContainText('updated@example.com');
    await close();
    await open('历史记录');
    await page.getByRole('button', { name: '删除此条记录', exact: true }).first().click();
    await expect(page.locator('.browser-data-row')).toHaveCount(3);
    await page.getByRole('button', { name: '删除浏览数据', exact: true }).click();
    if (native) {
      await page.getByRole('checkbox', { name: 'Cookie 和网站数据', exact: true }).uncheck();
      await page.getByRole('checkbox', { name: '缓存的图片和文件', exact: true }).uncheck();
    }
    await page.getByRole('button', { name: '删除数据', exact: true }).click(); await shot('clear-confirm');
    await page.getByRole('button', { name: '删除数据', exact: true }).last().click();
    await expect(page.getByText('所选数据已删除。', { exact: true })).toBeVisible();
    await close(); await expect(page.locator('.browser-data-row')).toHaveCount(1); await shot('history-after-delete');
    await close(); await open('密码管理');
    await expect(page.locator('.browser-password-row')).toHaveCount(1);
    assert.deepEqual(errors, []);
    results.push({ prefix, historySearch: true, deleteRange: true, passwordEdit: true, noOverflow: true });
    // This profile belongs exclusively to the fixture; leave subsequent matrix runs with the same seed.
    await page.evaluate(mode => localStorage.removeItem(`remoteai:browser-data:browser-data-${mode}`), mode);
  } catch (error) {
    await shot('failure'); await writeFile(`${output}/${prefix}-failure.txt`, await page.locator('body').innerText());
    throw error;
  }
  finally { if (!native) await context.close(); }
}
await writeFile(`${output}/${native ? 'pc' : 'web'}-results.json`, JSON.stringify(results, null, 2));
await browser.close();
console.log(`Browser history/password UI: ${results.length} variants passed`);
