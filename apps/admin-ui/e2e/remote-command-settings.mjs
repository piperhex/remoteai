import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

const built = await build({ entryPoints: ['shared/chat/chatPolicy.ts'], bundle: true, write: false,
  platform: 'node', format: 'esm' });
const { DEFAULT_CHAT_POLICY } = await import('data:text/javascript;base64,'
  + Buffer.from(built.outputFiles[0].text).toString('base64'));
const directory = resolve('.codex-tmp/remote-command-evidence');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch(testBrowserLaunchOptions({ headless: true }));
const results = [];
try {
  for (const scenario of [
    { name: 'admin-web-light-zh-default', language: 'zh', dark: false, width: 1440, manage: true },
    { name: 'admin-web-dark-en-narrow', language: 'en', dark: true, width: 960, manage: true },
    { name: 'admin-web-light-ru-readonly', language: 'ru', dark: false, width: 1440, manage: false },
  ]) {
    const context = await browser.newContext({ viewport: { width: scenario.width, height: 1000 } });
    const profile = { id: 'command-test-admin', email: 'admin@example.test', role: 'admin',
      permissions: ['admin.chat-settings.read', ...(scenario.manage ? ['admin.chat-settings.manage'] : [])] };
    await context.addInitScript(({ profile, scenario }) => {
      localStorage.setItem('codex-switch-admin-auth', JSON.stringify({
        accessToken: 'local-fixture', refreshToken: 'local-fixture', user: profile,
      }));
      localStorage.setItem('codex-switch-admin-language', scenario.language);
      localStorage.setItem('codex-switch-admin-theme', scenario.dark ? 'dark' : 'light');
    }, { profile, scenario });
    let policy = { ...DEFAULT_CHAT_POLICY };
    delete policy.remoteCommandConcurrencyLimit; // Legacy saved policy must load with five.
    let saves = 0;
    await context.route('**/auth/me', route => route.fulfill({ json: profile }));
    await context.route('**/admin/api/**', async route => {
      if (!route.request().url().endsWith('/chat-settings')) {
        await route.fulfill({ json: { items: [], total: 0 } }); return;
      }
      if (route.request().method() === 'PATCH') {
        assert(scenario.manage);
        policy = route.request().postDataJSON();
        saves++;
      }
      await route.fulfill({ json: policy });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:1431/admin.html');
    const field = page.locator('#remoteCommandConcurrencyLimit');
    await field.waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#remoteCommandConcurrencyLimit')?.value === '5');
    assert.equal(await field.inputValue(), '5');
    if (scenario.manage) {
      await page.waitForFunction(() => !document.querySelector('#remoteCommandConcurrencyLimit')?.disabled);
    }
    await page.screenshot({ path: resolve(directory, scenario.name + '.png') });
    if (scenario.manage) {
      await field.fill('8');
      await page.locator('button[type=submit]').click();
      await page.waitForFunction(() => document.querySelector('.ant-message-success'));
      assert.equal(saves, 1);
      assert.equal(policy.remoteCommandConcurrencyLimit, 8);
      assert.equal(policy.chatSessionLimit, 5);
      await page.locator('.chat-policy-remoteCommands').screenshot({
        path: resolve(directory, scenario.name + '-saved-eight.png'),
      });
      await field.fill('33');
      await page.locator('.chat-policy-page form').evaluate(form => form.requestSubmit());
      await page.locator('.chat-policy-remoteCommands .ant-form-item-explain-error').waitFor();
      assert.equal(saves, 1);
      await page.locator('.chat-policy-remoteCommands').screenshot({
        path: resolve(directory, scenario.name + '-invalid.png'),
      });
    } else {
      assert(await field.isDisabled());
      assert.equal(await page.locator('button[type=submit]').count(), 0);
    }
    assert.deepEqual(errors, []);
    results.push({ ...scenario, saves, fontSize: await field.evaluate(el => getComputedStyle(el).fontSize) });
    await context.close();
  }
  await writeFile(resolve(directory, 'verification.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); }
