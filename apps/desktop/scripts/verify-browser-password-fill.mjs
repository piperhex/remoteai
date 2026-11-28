import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { connectBrowserOverlay } from './browser-data-test-menu.mjs';

// Use the isolated WebView2 harness and fictional credentials only.
const endpoint = 'http://127.0.0.1:9355';
const fixtureOrigin = 'http://127.0.0.1:18449';
const harness = 'http://127.0.0.1:1572/e2e/browser-data-harness.html';
const output = fileURLToPath(new URL('../../../.codex-tmp/aws-password-fill/', import.meta.url));
const username = 'fixture-user@example.test', secret = 'fictional-split-password';
const submit = '<button>Sign in</button>';
const email = '<label>Email <input type="email" autocomplete="email" required></label>';
const password = '<label>Password <input type="password" autocomplete="current-password"></label>';

const server = createServer((request, response) => {
  const split = request.url === '/split';
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><title>Two-step sign-in fixture</title>
    <style>body{font:16px system-ui;padding:24px}main{max-width:400px}input,button{display:block;margin:10px 0;padding:6px}</style>
    <main><h1>Two-step sign-in fixture</h1>
    <form>${email}${split ? '<button id="next_button">Next</button>' : password + submit}</form><output></output></main>
    <script>
    const form = document.querySelector('form');
    form.onsubmit = event => {
      event.preventDefault();
      document.querySelector('output').textContent = 'Submitted';
    };
    if (${split}) document.querySelector('#next_button').onclick = event => {
      event.preventDefault();
      form.outerHTML = '<section>${password}<button type="button" id="signin_button">Sign in</button></section>';
      const field = document.querySelector('input');
      document.querySelector('#signin_button').onclick = () => document.querySelector('output').textContent = 'Submitted';
      field.focus();
    };
    </script>`);
});

async function navigate(page, engine, path) {
  const url = fixtureOrigin + path, address = page.getByLabel('页面地址', { exact: true });
  await address.fill(url);
  await address.press('Enter');
  if (!engine) await expect.poll(async () => {
    try { engine = await chromium.connectOverCDP('http://127.0.0.1:9356'); return true; }
    catch { return false; }
  }, { timeout: 30000 }).toBe(true);
  const sitePage = () => engine.contexts()[0].pages().find(candidate => candidate.url() === url);
  await expect.poll(() => Boolean(sitePage())).toBe(true);
  return { engine, site: sitePage() };
}

async function seedAccount(page, site) {
  await site.getByLabel('Email').fill(username);
  await site.getByLabel('Password').fill(secret);
  await site.getByRole('button', { name: 'Sign in' }).click();
  const save = page.getByRole('dialog', { name: '保存此网站的密码？', exact: true });
  await expect(save).toBeVisible();
  await save.getByLabel('密码库口令').fill('browser-test-passphrase');
  await save.getByRole('button', { name: '解锁密码库' }).click();
  await save.getByRole('button', { name: /保\s*存/ }).click();
  await expect(save).toBeHidden();
}

async function verifyFill(page, mode) {
  let engine, overlay;
  try {
    const scope = `browser-data-${mode}`;
    await page.evaluate(async scope => {
      await window.__TAURI_INTERNALS__.invoke('browser_vault_key', { scope, request: { action: 'remove' } });
      localStorage.removeItem(`remoteai:browser-data:${scope}`);
    }, scope);
    const remote = mode === 'remote';
    await page.goto(`${harness}?mode=${mode}${remote ? '&font=20&dark' : ''}`, { waitUntil: 'domcontentloaded' });
    await page.setViewportSize(remote ? { width: 900, height: 760 } : { width: 1280, height: 860 });
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
    let site;
    ({ engine, site } = await navigate(page, engine, '/seed'));
    await seedAccount(page, site);
    ({ engine, site } = await navigate(page, engine, '/split'));
    await site.getByLabel('Email').click();
    overlay = await connectBrowserOverlay(endpoint);
    const choices = overlay.popup.getByRole('dialog', { name: '选择要填入的账号', exact: true });
    await expect(choices).toBeVisible();
    await choices.screenshot({ path: `${output}${mode}-email-suggestions.png` });
    await choices.getByRole('button', { name: new RegExp(username) }).click();
    await expect(site.getByLabel('Email')).toHaveValue(username);
    await expect(site.getByLabel('Password')).toHaveCount(0);
    await site.getByRole('button', { name: 'Next' }).click();
    await expect(site.getByLabel('Password')).toHaveValue(secret);
    assert.equal(await site.locator('output').textContent(), '');
    await site.locator('main').screenshot({ path: `${output}${mode}-password-filled.png` });
    console.log(`Windows WebView2 ${mode}: the selected account filled both steps without submitting`);
  } finally {
    await overlay?.connection.close();
    await engine?.close();
  }
}

await mkdir(output, { recursive: true });
await new Promise(resolve => server.listen(18449, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.connectOverCDP(endpoint);
  const page = browser.contexts()[0].pages().find(candidate => candidate.url().startsWith(harness));
  assert.ok(page, 'Start the isolated browser data harness before verification');
  for (const mode of ['local', 'remote']) await verifyFill(page, mode);
} finally {
  await browser?.close();
  server.closeAllConnections();
  server.close();
}
