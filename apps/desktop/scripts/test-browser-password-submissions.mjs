import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium } from '@playwright/test';
import { testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';

const script = await readFile(new URL('../src-tauri/resources/browser-password.js', import.meta.url), 'utf8');
const origin = 'https://mail.example.test';
const login = { origin, username: 'user@example.test', password: 'fixture-only' };

test('a login attempt offers its password once and only for an eligible form', async t => {
  const browser = await chromium.launch(testBrowserLaunchOptions());
  t.after(() => browser.close());
  const cases = [
    { name: 'command disables fields and cancels the icon click', handler: `event.preventDefault();
      event.stopPropagation(); form.elements.password.disabled = true; form.elements.password.value = '';` },
    { name: 'Enter activates the command submitter', enter: true, handler: 'event.preventDefault()' },
    { name: 'ordinary submit' },
    { name: 'command also requests a native submit', handler: `event.preventDefault();
      form.elements.password.disabled = true; form.requestSubmit(button)` },
    { name: 'input submitter', control: '<input type="submit">', handler: 'event.preventDefault()' },
    { name: 'synthetic command click', synthetic: true, handler: 'event.preventDefault()', count: 0 },
    { name: 'non-submit button', control: '<button type="button">Other</button>', count: 0 },
    { name: 'invalid email', username: 'invalid', handler: 'event.preventDefault()', count: 0 },
    { name: 'hidden password', passwordAttrs: 'style="display:none"', handler: 'event.preventDefault()', count: 0 },
    { name: 'new password in a command form', autocomplete: 'new-password',
      handler: 'event.preventDefault()', count: 0 },
    { name: 'cross-origin form', action: 'https://other.example/', handler: 'event.preventDefault()', count: 0 },
    { name: 'cross-origin button override', control: '<button formaction="https://other.example/">Enter</button>',
      handler: 'event.preventDefault()', count: 0 },
    { name: 'destination changed by command', handler: "event.preventDefault(); form.action='https://other.example/'",
      count: 0 },
  ];
  for (const scenario of cases) await t.test(scenario.name, async () => {
    const page = await browser.newPage();
    try {
      const control = scenario.control ?? '<button type="submit"><span>Enter</span></button>';
      await page.route(origin + '/', route => route.fulfill({ contentType: 'text/html', body: `
        <form action="${scenario.action ?? '#/'}" onsubmit="event.preventDefault()">
        <input name="email" type="email" autocomplete="email" value="${scenario.username ?? login.username}">
        <input name="password" type="password" autocomplete="${scenario.autocomplete ?? 'current-password'}"
          value="${login.password}" ${scenario.passwordAttrs ?? ''}>${control}</form>
        <script>const form=document.forms[0], button=form.lastElementChild;
        button.addEventListener('click',event=>{${scenario.handler ?? ''}});</script>` }));
      await page.addInitScript({ content: `window.records = [];
        window.ReactNativeWebView = { postMessage(message) {
          const record = JSON.parse(message);
          if (record.type === 'browser-login') window.records.push(record.login);
        } };
        ${script}; RemoteAIBrowserPassword.passwordPage({action:'install',native:true});` });
      await page.goto(origin + '/');
      if (scenario.enter) await page.locator('[name=password]').press('Enter');
      else if (scenario.synthetic) await page.locator('button').evaluate(button => button.click());
      else await page.locator('button span, button:not(:has(span)), input[type=submit]').click();
      // Let the browser finish the click's default action and any deferred capture decision.
      const captured = await page.evaluate(() => new Promise(resolve => setTimeout(() => resolve(window.records), 0)));
      assert.deepEqual(captured, scenario.count === 0 ? [] : [login]);
    } finally { await page.close(); }
  });
});
