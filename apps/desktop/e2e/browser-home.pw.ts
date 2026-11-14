import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { homeArchive } from '../scripts/browser-home-fixture';

const API = 'http://127.0.0.1:1591';
const headers = { Authorization: 'Bearer home-fixture' };
const home = (page: Page) => page.frameLocator('iframe.browser-custom-home:visible');
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  console.log(await page.evaluate(async () => ({
    frames: [...document.querySelectorAll('iframe')].map(frame => ({ src: frame.src, hidden: frame.hidden })),
    storage: { ...localStorage },
    workers: (await navigator.serviceWorker.getRegistrations()).map(worker => ({ scope: worker.scope, active: worker.active?.scriptURL })),
    caches: await caches.keys(),
  })));
});
async function upload(request: APIRequestContext, version: string) {
  const response = await request.post(`${API}/admin/api/browser-home/archive?name=dist.zip`, {
    headers: { ...headers, 'Content-Type': 'application/zip' }, data: await homeArchive(version),
  });
  expect(response.status(), await response.text()).toBe(201);
  expect((await request.patch(`${API}/admin/api/browser-home`, { headers, data: { enabled: true } })).ok()).toBe(true);
  return response.json();
}
const navigation = (page: Page) => page.locator('.sidebar-tabs');
async function enter(page: Page) {
  await navigation(page).getByRole('button', { name: 'Agent Hub', exact: true }).click();
  await navigation(page).getByRole('button', { name: '浏览器', exact: true }).click();
}

test('Admin uploads, previews and disables a real React dist ZIP', async ({ page }, info) => {
  await page.addInitScript(() => {
    localStorage.setItem('codex-switch-admin-language', 'zh');
    localStorage.setItem('codex-switch-admin-auth', JSON.stringify({ accessToken: 'home-fixture', refreshToken: 'fixture',
      user: { id: 'home-fixture', email: 'home@fixture.test', role: 'admin',
        permissions: ['admin.browser-home.read', 'admin.browser-home.manage'] } }));
  });
  await page.route('**/auth/me', route => route.fulfill({ json: { id: 'home-fixture', email: 'home@fixture.test', role: 'admin',
    permissions: ['admin.browser-home.read', 'admin.browser-home.manage'] } }));
  await page.goto('http://127.0.0.1:1592/admin.html');
  await page.locator('input[type=file]').setInputFiles({ name: 'dist.zip', mimeType: 'application/zip', buffer: await homeArchive('A') });
  await expect(page.getByText('dist.zip', { exact: false }).first()).toBeVisible();
  await page.getByRole('switch', { name: '启用自定义首页' }).click();
  await expect(page.getByRole('switch', { name: '启用自定义首页' })).toBeChecked();
  await page.getByRole('button', { name: '预览首页' }).click();
  const preview = page.frameLocator('iframe[title="预览首页"]');
  await expect(preview.getByRole('heading', { name: '自定义首页 A' })).toBeVisible();
  await preview.getByRole('button', { name: '已点击 0 次' }).click();
  await expect(preview.getByRole('button', { name: '已点击 1 次' })).toBeVisible();
  await expect(page.locator('.ant-message-notice')).toHaveCount(0);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('admin-light-home-preview.png') });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.screenshot({ animations: 'disabled', path: info.outputPath('admin-light-home-settings.png') });
  await page.getByRole('button', { name: '恢复默认首页' }).click();
  await expect(page.getByRole('switch', { name: '启用自定义首页' })).not.toBeChecked();
});

for (const mode of ['local', 'remote']) test(`${mode}: MD5 cache checks only on entry and retains old home`, async ({ page, request }, info) => {
  await upload(request, 'A');
  let checks = 0, packages = 0;
  page.on('request', req => {
    if (req.url().endsWith('/browser-home/current')) checks++;
    if (req.url().includes('/browser-home/packages/')) packages++;
  });
  await page.goto(`/e2e/browser-bookmarks-harness.html?mode=${mode}&homeBase=${API}&startOutside`);
  await page.waitForTimeout(350);
  expect(checks).toBe(0);
  await navigation(page).getByRole('button', { name: '浏览器', exact: true }).click();
  await expect(home(page).getByRole('heading', { name: '自定义首页 A' })).toBeVisible();
  await expect(home(page).locator('body')).toHaveAttribute('data-chunk', 'ready');
  expect(await home(page).locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(await home(page).locator('body').evaluate(async () => {
    const scope = window as unknown as { loadHomeChunk: () => Promise<{ value: string }> };
    return (await scope.loadHomeChunk()).value;
  })).toBe('lazy-ready');
  await home(page).getByRole('button', { name: '已点击 0 次' }).click();
  await expect(home(page).getByRole('button', { name: '已点击 1 次' })).toBeVisible();
  expect(packages).toBe(1);
  await enter(page);
  await expect.poll(() => checks).toBe(2);
  expect(packages).toBe(1);
  await expect(home(page).getByRole('button', { name: '已点击 1 次' })).toBeVisible();
  await upload(request, 'B');
  await page.waitForTimeout(350); expect(checks).toBe(2);
  let resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  await page.route(`${API}/browser-home/packages/**`, async route => { await gate; await route.continue(); });
  await enter(page);
  await expect.poll(() => packages).toBe(2);
  await expect(home(page).getByRole('heading', { name: '自定义首页 A' })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`desktop-${mode}-light-updating-keeps-cache.png`) });
  resume();
  await expect(home(page).getByRole('heading', { name: '自定义首页 B' })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`desktop-${mode}-light-home.png`) });
  await upload(request, 'Broken');
  await page.unroute(`${API}/browser-home/packages/**`);
  await page.route(`${API}/browser-home/packages/**`, route => route.fulfill({ json: { broken: true } }));
  await enter(page);
  await expect.poll(() => packages).toBe(3);
  await expect(home(page).getByRole('heading', { name: '自定义首页 B' })).toBeVisible();
  await page.route(`${API}/browser-home/current`, route => route.abort());
  await page.reload();
  await navigation(page).getByRole('button', { name: '浏览器', exact: true }).click();
  await expect(home(page).getByRole('heading', { name: '自定义首页 B' })).toBeVisible();
  await home(page).getByRole('link', { name: '打开工作空间' }).click();
  await expect(page.getByRole('textbox', { name: '页面地址' })).toHaveValue('https://home.example.test/');
});

test('first visit is blank until ready; sidebar and mobile do not check custom home', async ({ page, request }, info) => {
  await upload(request, 'C');
  await page.route(`${API}/browser-home/packages/**`, route => route.abort());
  await page.goto(`/e2e/browser-bookmarks-harness.html?mode=local&homeBase=${API}`);
  await expect(page.locator('iframe.browser-custom-home')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('desktop-local-first-visit-blank.png') });
  let checks = 0;
  page.on('request', req => { if (req.url().endsWith('/browser-home/current')) checks++; });
  await page.goto(`/e2e/browser-bookmarks-harness.html?sidebar&homeBase=${API}`);
  await page.waitForTimeout(350); expect(checks).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/e2e/browser-bookmarks-harness.html?homeBase=${API}`);
  await page.waitForTimeout(350); expect(checks).toBe(0);
});

for (const mode of ['local', 'remote']) test(`Native cache: ${mode} desktop dark enlarged`, async ({ page, request }, info) => {
  await upload(request, 'Native');
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(`/e2e/browser-bookmarks-harness.html?mode=${mode}&homeBase=${API}&nativeHome&dark&font=20`);
  await expect(home(page).getByRole('heading', { name: '自定义首页 Native' })).toBeVisible();
  await home(page).getByRole('button', { name: '已点击 0 次' }).click();
  await expect(home(page).getByRole('button', { name: '已点击 1 次' })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`desktop-${mode}-native-cache-dark-20px-narrow.png`) });
});

for (const dark of [false, true]) test(`Web desktop custom home ${dark ? 'dark enlarged' : 'light'}`, async ({ page, request }, info) => {
  await upload(request, 'Web');
  await page.setViewportSize({ width: dark ? 1000 : 1440, height: 900 });
  await page.addInitScript(({ base, dark }) => {
    localStorage.setItem('codex-switch.web.language.v1', 'zh');
    localStorage.setItem('codex-switch.web.theme.v1', dark ? 'dark' : 'light');
    localStorage.setItem('codex-switch:global-font-size', dark ? '20' : '14');
    localStorage.setItem('codex-switch.web.session.v1', JSON.stringify({ baseUrl: base,
      email: 'home@fixture.test', accessToken: 'fixture', refreshToken: 'fixture' }));
  }, { base: API, dark });
  await page.route(`${API}/**`, route => route.request().url().includes('/browser-home/')
    ? route.continue() : route.fulfill({ json: { accounts: [], providers: [], devices: [], id: 'home', email: 'home@fixture.test' } }));
  await page.goto('http://127.0.0.1:1579/web/');
  await page.locator('.desktop-sidebar nav').getByRole('button', { name: '浏览器', exact: true }).click();
  await expect(home(page).getByRole('heading', { name: '自定义首页 Web' })).toBeVisible();
  await expect(page.locator('.adm-toast-mask')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`web-${dark ? 'dark-20px-narrow' : 'light-14px-wide'}-home.png`) });
});
