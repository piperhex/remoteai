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
    { name: 'command clears a required password after accepting it', passwordAttrs: 'required',
      handler: "event.preventDefault(); form.elements.password.value = '';" },
    { name: 'Enter activates the command submitter', enter: true, handler: 'event.preventDefault()' },
    { name: 'ordinary submit' },
    { name: 'IAM username follows the account ID', account: '<input name="account" value="123456789012">',
      usernameName: 'username', autocomplete: 'on' },
    { name: 'command also requests a native submit', handler: `event.preventDefault();
      form.elements.password.disabled = true; form.requestSubmit(button)` },
    { name: 'input submitter', control: '<input type="submit">', handler: 'event.preventDefault()' },
    { name: 'synthetic command click', synthetic: true, handler: 'event.preventDefault()', count: 0 },
    { name: 'non-submit button', control: '<button type="button">Other</button>', count: 0 },
    { name: 'invalid email', username: 'invalid', handler: 'event.preventDefault()', count: 0 },
    { name: 'native validation blocks a short username in an email field', username: 'mail-user', count: 0 },
    ...[false, true].map(enter => ({
      name: `mail login command accepts a short username via ${enter ? 'Enter' : 'click'}`,
      username: 'mail-user', enter, handler: `event.preventDefault();
        form.elements.email.disabled = true;
        form.elements.password.disabled = true;
        form.elements.password.value = '';`,
    })),
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
        ${scenario.account ?? ''}
        <input name="${scenario.usernameName ?? 'email'}" type="${scenario.account ? 'text' : 'email'}"
          autocomplete="${scenario.account ? 'on' : 'email'}" value="${scenario.username ?? login.username}">
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
      const expected = { ...login, username: scenario.username ?? login.username };
      assert.deepEqual(captured, scenario.count === 0 ? [] : [expected]);
    } finally { await page.close(); }
  });
});

test('username-first login offers credentials after a JavaScript password step advances', async t => {
  const browser = await chromium.launch(testBrowserLaunchOptions());
  t.after(() => browser.close());
  const cases = [
    { name: 'sign-in button', capture: true },
    { name: 'Enter in the password field', enter: true, capture: true },
    { name: 'native submit advances the username step', nativeNext: true, capture: true },
    { name: 'failed password stays on the page', failed: true },
    { name: 'unrelated button does not qualify', unrelated: true },
    { name: 'synthetic click does not qualify', synthetic: true },
    { name: 'new password does not qualify', newPassword: true },
    { name: 'cross-origin username form does not qualify', crossOrigin: true },
    { name: 'full navigation after login', navigate: true, capture: true },
  ];
  for (const scenario of cases) await t.test(scenario.name, async () => {
    const page = await browser.newPage();
    const captured = [];
    try {
      await page.exposeBinding('recordLogin', (_, message) => { captured.push(message); });
      await page.addInitScript({ content: `
        window.ReactNativeWebView = { postMessage(message) {
          const record = JSON.parse(message);
          if (record.type === 'browser-login') window.recordLogin(record.login);
        } };
        ${script}; RemoteAIBrowserPassword.passwordPage({action:'install',native:true});` });
      await page.route(origin + '/done', route => route.fulfill({ body: 'Done' }));
      await page.route(origin + '/', route => route.fulfill({ contentType: 'text/html', body: `
        <main><form action="${scenario.crossOrigin ? 'https://other.example/' : '/'}">
          <input type="email" autocomplete="email" required><button>Next</button>
        </form></main>
        <script>const main = document.querySelector('main');
        main.querySelector('${scenario.nativeNext ? 'form' : 'button'}').${scenario.nativeNext ? 'onsubmit' : 'onclick'}
          = event => {
          event.preventDefault();
          main.innerHTML = '<section><div><input type="password" value="${login.password}"'
            + ' autocomplete="${scenario.newPassword ? 'section-auth new-password' : 'on'}"></div>'
            + '<div><button type="button" id="${scenario.unrelated ? 'showPassword' : 'signin_button'}">'
            + '<span>Sign in</span></button></div></section>';
          const password = main.querySelector('input');
          const authenticate = () => setTimeout(() => {
            ${scenario.failed ? "password.value = ''; main.insertAdjacentHTML('beforeend', '<p>Rejected</p>');"
              : scenario.navigate ? "location.href = '/done'" : "main.innerHTML = '<p>Next step</p>'"}
          }, 50);
          main.querySelector('button').onclick = authenticate;
          password.onkeyup = event => { if (event.key === 'Enter') authenticate(); };
        };</script>` }));
      await page.goto(origin + '/');
      await page.locator('input[type=email]').fill(login.username);
      await page.getByRole('button', { name: 'Next' }).click();
      assert.deepEqual(captured, []);
      if (scenario.enter) await page.locator('input[type=password]').press('Enter');
      else if (scenario.synthetic) await page.getByRole('button', { name: 'Sign in' }).evaluate(button => button.click());
      else await page.locator('button span').click();
      if (scenario.navigate) await page.waitForURL('**/done');
      else await page.getByText(scenario.failed ? 'Rejected' : 'Next step', { exact: true }).waitFor();
      assert.deepEqual(captured, scenario.capture ? [login] : []);
    } finally { await page.close(); }
  });
});
