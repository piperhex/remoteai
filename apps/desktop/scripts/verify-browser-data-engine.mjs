import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const output = fileURLToPath(new URL('../../../.codex-tmp/browser-data/', import.meta.url));
await mkdir(output, { recursive: true });
const openssl = process.env.OPENSSL_PATH ?? (process.platform === 'win32'
  ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
  '-keyout', `${output}/fixture-key.pem`, '-out', `${output}/fixture-cert.pem`], { windowsHide: true, stdio: 'ignore' });
const server = createServer({ key: await readFile(`${output}/fixture-key.pem`),
  cert: await readFile(`${output}/fixture-cert.pem`) }, (_request, response) => {
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><html><meta name="viewport" content="width=device-width"><title>Browser login fixture</title>
    <style>body{font:18px sans-serif;padding:24px}input,button{display:block;margin:16px;padding:12px}</style>
    <form onsubmit="event.preventDefault();document.querySelector('output').textContent='Submitted'">
      <input aria-label="Username" autocomplete="username"><input aria-label="Password" type="password"
      autocomplete="current-password"><button>Sign in</button></form><output></output></html>`);
});
await new Promise(resolve => server.listen(18443, '127.0.0.1', resolve));
const browser = await chromium.connectOverCDP('http://127.0.0.1:9355');
const page = browser.contexts()[0].pages().find(page => page.url().includes('browser-data-harness'));
const invoke = (command, args) => page.evaluate(([command, args]) => window.__TAURI_INTERNALS__.invoke(command, args),
  [command, args]);
let engine;
async function verify(mode, font = 14) {
  const scope = `browser-data-${mode}`;
  await invoke('browser_vault_key', { scope, request: { action: 'remove' } });
  await page.evaluate(scope => localStorage.removeItem(`remoteai:browser-data:${scope}`), scope);
  await page.goto(`http://127.0.0.1:1572/e2e/browser-data-harness.html?mode=${mode}&font=${font}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const address = page.getByRole('textbox', { name: '页面地址' });
  await address.fill('https://127.0.0.1:18443'); await address.press('Enter');
  await expect.poll(async () => {
    try { engine = await chromium.connectOverCDP('http://127.0.0.1:9356'); return true; } catch { return false; }
  }, { timeout: 30000 }).toBe(true);
  await expect.poll(() => engine.contexts()[0].pages().some(page => page.url().includes('18443'))).toBe(true);
  const site = engine.contexts()[0].pages().find(page => page.url().includes('18443'));
  await expect(site.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await site.evaluate(() => { document.cookie = 'browser_test=present; Secure; SameSite=Lax';
    localStorage.setItem('browser-test', 'present'); });
  await site.getByLabel('Username').fill('engine-fixture-user');
  await site.getByLabel('Password', { exact: true }).fill('engine-fixture-secret');
  await site.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('保存此网站的密码？', { exact: true })).toBeVisible();
  await page.getByLabel('密码库口令', { exact: true }).fill('browser-test-passphrase');
  await page.getByRole('button', { name: '解锁密码库', exact: true }).click();
  await page.screenshot({ path: `${output}/pc-${mode}-login-save-prompt.png` });
  await page.getByRole('button', { name: /保\s*存/ }).click();
  await site.getByLabel('Username').fill(''); await site.getByLabel('Password', { exact: true }).fill('');
  await site.getByLabel('Username').click();
  const choices = page.getByRole('dialog', { name: '选择要填入的账号', exact: true });
  await expect(choices).toBeVisible();
  await expect(page.locator('.native-browser-overlay-preview')).toBeVisible();
  await page.screenshot({ path: `${output}/pc-${mode}-${font}px-account-suggestions.png` });
  await choices.getByRole('button', { name: /engine-fixture-user/ }).click();
  await expect(site.getByLabel('Password', { exact: true })).toHaveValue('engine-fixture-secret');
  await expect(site.getByLabel('Username')).toHaveValue('engine-fixture-user');
  await invoke('provider_browser_clear_data', { request: { cookies: false, cache: true } });
  assert.match(await site.evaluate(() => document.cookie), /browser_test=present/);
  assert.equal(await site.evaluate(() => localStorage.getItem('browser-test')), 'present');
  await invoke('provider_browser_clear_data', { request: { cookies: true, cache: false } });
  assert.equal(await site.evaluate(() => document.cookie), '');
  assert.equal(await site.evaluate(() => localStorage.getItem('browser-test')), null);
  await engine.close(); engine = undefined;
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await address.fill('https://127.0.0.1:18443'); await address.press('Enter');
  await expect.poll(async () => {
    try { engine = await chromium.connectOverCDP('http://127.0.0.1:9356'); return true; } catch { return false; }
  }, { timeout: 30000 }).toBe(true);
  await expect.poll(() => engine.contexts()[0].pages().some(page => page.url().includes('18443'))).toBe(true);
  const restored = engine.contexts()[0].pages().find(page => page.url().includes('18443'));
  await restored.getByLabel('Password', { exact: true }).click();
  await expect(choices).toBeVisible();
  await expect(choices.getByLabel('密码库口令', { exact: true })).toHaveCount(0);
  await expect(page.locator('.native-browser-overlay-preview')).toBeVisible();
  await page.screenshot({ path: `${output}/pc-${mode}-remembered-unlock.png` });
  await choices.getByRole('button', { name: /engine-fixture-user/ }).click();
  await expect(restored.getByLabel('Password', { exact: true })).toHaveValue('engine-fixture-secret');
  if (mode === 'local') {
    await page.getByRole('button', { name: '浏览器设置', exact: true }).click();
    await page.getByRole('button', { name: '密码管理', exact: true }).click();
    await page.getByRole('button', { name: '锁定密码库', exact: true }).click();
    await page.locator('.ant-modal-wrap:visible .ant-modal-close').click();
    await restored.getByLabel('Username').click();
    await expect(choices.getByLabel('密码库口令', { exact: true })).toBeVisible();
    await page.screenshot({ path: `${output}/pc-local-first-input-unlock.png` });
    await choices.getByLabel('密码库口令', { exact: true }).fill('browser-test-passphrase');
    await choices.getByRole('button', { name: '解锁密码库', exact: true }).click();
    await choices.getByRole('button', { name: /engine-fixture-user/ }).click();
  }
  await engine.close(); engine = undefined;
}
try {
  await verify('local'); await verify('remote', 20);
  await writeFile(`${output}/pc-engine-results.json`, JSON.stringify({ capture: true, save: true, inputSuggestions: true,
    rememberedUnlock: true, modes: ['local', 'remote'], cookies: true, localStorage: true, selectiveCache: true }));
  console.log('Real WebView2 input suggestions, filling, remembered unlock and site data clearing passed');
} finally { await engine?.close(); await browser.close(); server.closeAllConnections(); server.close(); }
