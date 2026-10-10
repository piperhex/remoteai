import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const metadata = readFileSync(new URL('../../../package.json', import.meta.url), 'utf8');
const { version } = JSON.parse(metadata) as { version: string };

const MANIFEST = '**/web/version.json?*';
const IGNORED_KEY = 'codex-switch.web.ignored-update-version.v1';

test('checks at startup, remembers a skipped version, and prompts for the next version', async ({ page }, info) => {
  let available = '99.0.0';
  let requests = 0;
  await page.route(MANIFEST, async (route) => {
    requests += 1;
    await route.fulfill({ json: { version: available } });
  });
  await page.goto('./');
  await expect(page.getByText('发现新版本', { exact: true })).toBeVisible();
  expect(requests).toBe(1);
  await expect(page.getByText('Remote AI v99.0.0 已发布，刷新页面即可更新。')).toBeVisible();
  const dialog = page.locator('.adm-dialog-body');
  const bounds = await dialog.boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(400);
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('startup-update.png') });
  await page.getByRole('button', { name: '忽略本版本', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate((key) => localStorage.getItem(key), IGNORED_KEY)).toBe(available);
  await page.reload();
  await expect.poll(() => requests).toBe(2);
  await expect(page.getByRole('button', { name: '登录并查看' })).toBeVisible();
  await expect(dialog).toBeHidden();
  available = '99.1.0';
  await page.reload();
  await expect(page.getByText('Remote AI v99.1.0 已发布，刷新页面即可更新。')).toBeVisible();
  expect(requests).toBe(3);
});

test('update now reloads the page without ignoring the release', async ({ page }) => {
  let requests = 0;
  await page.route(MANIFEST, async (route) => {
    await route.fulfill({ json: { version: requests++ === 0 ? '99.0.0' : version } });
  });
  await page.goto('./?source=test#chat');
  await page.getByRole('button', { name: '立即更新', exact: true }).click();
  await page.waitForURL(/_update=/);
  await expect.poll(() => requests).toBe(2);
  expect(new URL(page.url()).searchParams.get('source')).toBe('test');
  expect(new URL(page.url()).hash).toBe('#chat');
  expect(await page.evaluate((key) => localStorage.getItem(key), IGNORED_KEY)).toBeNull();
  await expect(page.locator('.adm-dialog-body')).toBeHidden();
});

for (const available of [version, '0.0.1', 'invalid']) {
  test(`does not interrupt startup for version ${available}`, async ({ page }) => {
    await page.route(MANIFEST, (route) => route.fulfill({ json: { version: available } }));
    await page.goto('./');
    await expect(page.getByRole('button', { name: '登录并查看' })).toBeVisible();
    await expect(page.locator('.adm-dialog-body')).toBeHidden();
  });
}

test('network failure does not prevent startup, and a new launch retries', async ({ page }) => {
  let offline = true;
  await page.route(MANIFEST, (route) => offline
    ? route.abort('internetdisconnected') : route.fulfill({ json: { version: '99.0.0' } }));
  await page.goto('./');
  await expect(page.getByRole('button', { name: '登录并查看' })).toBeVisible();
  await expect(page.locator('.adm-dialog-body')).toBeHidden();
  offline = false;
  await page.reload();
  await expect(page.getByText('发现新版本', { exact: true })).toBeVisible();
});

test('shows the update choices in English', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('codex-switch.web.language.v1', 'en'));
  await page.route(MANIFEST, (route) => route.fulfill({ json: { version: '99.0.0' } }));
  await page.goto('./');
  await expect(page.getByText('Update available', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip this version' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update now' })).toBeVisible();
});

for (const network of ['wifi', 'cellular', 'unknown']) {
  test(`idle preparation respects the ${network} network without reloading`, async ({ page }) => {
    await page.clock.install();
    await page.addInitScript(type => {
      Object.defineProperty(navigator, 'connection', { configurable: true, value: { type, saveData: false } });
    }, network);
    await page.route(MANIFEST, route => route.fulfill({ json: { version: '99.0.0' } }));
    let fetched = 0;
    await page.route('**/web/', async route => {
      if (route.request().resourceType() !== 'fetch') { await route.continue(); return; }
      await route.fulfill({ contentType: 'text/html', body:
        '<script type="module" src="/web/assets/idle-update.js"></script>'
        + '<script type="module" src="https://untrusted.example/external.js"></script>' });
    });
    await page.route('**/assets/idle-update.js', route => {
      fetched += 1;
      return route.fulfill({ contentType: 'text/javascript', body: 'window.updateMustNotExecute = true;' });
    });
    await page.goto('./');
    await expect(page.getByText('发现新版本', { exact: true })).toBeVisible();
    await page.clock.fastForward(90_000);
    if (network === 'wifi') await expect.poll(() => fetched).toBe(1);
    else expect(fetched).toBe(0);
    await expect(page.getByText('发现新版本', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => 'updateMustNotExecute' in window)).toBe(false);
    expect(new URL(page.url()).searchParams.has('_update')).toBe(false);
  });
}
