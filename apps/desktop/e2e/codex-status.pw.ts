import { expect, test, type Page } from '@playwright/test';
import type { CodexServiceStatus } from '../../../shared/codex-status/status';
import type { BrowserRequest } from '../../../shared/browser/automation';

async function setup(page: Page) {
  let value: CodexServiceStatus | null = { api: 'operational', cli: 'operational' };
  const requests: string[] = [];
  const preview = await page.context().newPage();
  await preview.setViewportSize({ width: 1000, height: 700 });
  await preview.setContent('<body style="font:18px system-ui;padding:40px;color:#202c29;background:#fff">'
    + '<h1>OpenAI Status</h1><p>System status</p><hr><h2>Codex API</h2><p>Operational</p>'
    + '<hr><h2>CLI</h2><p>Operational</p></body>');
  const image = (await preview.screenshot()).toString('base64');
  await preview.close();
  const browser = (request: BrowserRequest) => request.command.action === 'open'
    ? { tab: { id: 'test-status-page', threadId: request.threadId, url: 'https://status.openai.com/', title: 'OpenAI Status' } }
    : { result: { url: 'https://status.openai.com/', viewport: { width: 1000, height: 700 },
      image: { mimeType: 'image/png', data: image } } };
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.route('**/__codex_switch__/api/invoke', route => {
    const { command, args } = route.request().postDataJSON();
    if (command === 'codex_gui_browser') return route.fulfill({ json: { ok: true, result: browser(args.request) } });
    if (command === 'get_codex_service_status') {
      requests.push('local');
      return route.fulfill({ json: { ok: value !== null, result: value, error: 'offline' } });
    }
    let result: unknown = {};
    if (command === 'codex_gui_events') result = { cursor: { streamId: 'fixture', sequence: 1 }, events: [] };
    if (command === 'codex_gui_request') result = { data: { data: [], nextCursor: null } };
    return route.fulfill({ json: { ok: true, result } });
  });
  await page.route('**/fixture-remote', route => {
    const body = route.request().postDataJSON();
    if (body.operation === 'guiBrowser') return route.fulfill({ json: browser(body.request) });
    expect(route.request().postDataJSON()).toEqual({ operation: 'guiCodexServiceStatus' });
    requests.push('remote');
    return route.fulfill({ status: value ? 200 : 503, json: value ?? {} });
  });
  return { requests, set: (next: CodexServiceStatus | null) => { value = next; } };
}

for (const mode of ['local', 'remote', 'web']) {
  for (const dark of [false, true]) {
    test(`${mode} ${dark ? 'dark narrow' : 'light wide'} status and internal browser`, async ({ page }, info) => {
      if (dark) await page.setViewportSize({ width: 1024, height: 800 });
      const fixture = await setup(page);
      await page.clock.install();
      await page.goto(`/e2e/codex-status-harness.html?mode=${mode}${dark ? '&dark=1' : ''}`,
        { waitUntil: 'domcontentloaded' });
      const status = page.locator('.codex-service-status');
      await expect(status).toHaveText('正常');
      expect(fixture.requests).toEqual([mode === 'local' ? 'local' : 'remote']);
      const text = page.locator('.codex-version-status');
      await expect(text).toHaveText('Codex 0.166.0·正常');
      const fontSizes = await text.evaluate(element => [...element.children].map(child => getComputedStyle(child).fontSize));
      expect(new Set(fontSizes).size).toBe(1);
      await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark-narrow' : 'light-wide'}-normal.png`) });
      for (const [state, value] of [
        ['api-disrupted', { api: 'disrupted', cli: 'operational' }],
        ['cli-disrupted', { api: 'operational', cli: 'disrupted' }],
        ['unknown', null],
      ] as const) {
        fixture.set(value);
        await page.clock.fastForward(300_000);
        await expect(status).toHaveText(value ? '服务异常' : '状态未知');
        await expect(status).toHaveAttribute('data-status', value ? 'disrupted' : 'unknown');
        await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark-narrow' : 'light-wide'}-${state}.png`) });
        await status.click();
        const browser = page.getByRole('dialog', { name: 'OpenAI 服务状态' });
        await expect(browser).toBeVisible();
        const bounds = (await browser.boundingBox())!;
        expect(Math.abs(bounds.width - page.viewportSize()!.width * 0.85)).toBeLessThan(2);
        expect(Math.abs(bounds.height - page.viewportSize()!.height * 0.85)).toBeLessThan(2);
        await expect(browser.getByRole('textbox', { name: '页面地址' })).toHaveValue('https://status.openai.com/');
        await expect(browser.locator('.codex-status-preview-page img')).toBeVisible();
        if (state === 'api-disrupted') {
          await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark' : 'light'}-browser.png`) });
        }
        await browser.getByRole('button', { name: '关闭', exact: true }).click();
      }
      fixture.set({ api: 'operational', cli: 'operational' });
      await page.clock.fastForward(300_000);
      await expect(status).toHaveText('正常');
      await status.click();
      await expect(page.getByRole('dialog', { name: 'OpenAI 服务状态' })).toBeVisible();
      await page.getByRole('button', { name: '关闭', exact: true }).click();
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('spinbutton', { name: '刷新间隔（分钟）' }).fill('1');
      await page.clock.runFor(500);
      await expect(page.getByRole('spinbutton', { name: '刷新间隔（分钟）' })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark' : 'light'}-settings.png`),
        animations: 'disabled' });
      const before = fixture.requests.length;
      await page.clock.fastForward(60_000);
      await expect.poll(() => fixture.requests.length).toBeGreaterThan(before);
    });
  }
}

test('disconnected remote status opens internally and preferences survive reload and language switching', async ({ page }) => {
  await setup(page);
  await page.goto('/e2e/codex-status-harness.html?mode=remote', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.codex-service-status')).toHaveText('正常');
  await page.getByRole('button', { name: '切换连接' }).click();
  await expect(page.locator('.codex-service-status')).toHaveText('状态未知');
  await page.locator('.codex-service-status').click();
  await expect(page.getByRole('dialog', { name: 'OpenAI 服务状态' })).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('spinbutton', { name: '刷新间隔（分钟）' }).fill('10');
  await page.reload({ waitUntil: 'domcontentloaded' });
  for (const [language, label] of [['en', 'Operational'], ['ja', '正常'], ['ru', 'Работает'], ['zh', '正常']]) {
    await page.getByLabel('Language').selectOption(language);
    await expect(page.locator('.codex-service-status')).toHaveText(label);
  }
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '刷新间隔（分钟）' })).toHaveValue('10');
});
