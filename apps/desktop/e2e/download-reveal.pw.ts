import { expect, test } from '@playwright/test';
import type {} from './download-manager-harness';

interface FileRequest { action: string; id?: string; name?: string; size?: number; data?: string }
declare global { interface Window { downloadRevealFixture: { requests: FileRequest[]; fail: boolean } } }

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.addInitScript(() => {
    const fixture = { requests: [] as FileRequest[], fail: false };
    window.downloadRevealFixture = fixture;
    Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: {
      transformCallback: () => 1, unregisterCallback: () => {},
      invoke: async (command: string, args: { request?: FileRequest }) => {
        if (command !== 'download_file_action' || !args.request) throw new Error('Unused fixture command');
        fixture.requests.push(args.request);
        if (fixture.fail && args.request.action === 'reveal') throw new Error('Private system path');
        return args.request.action === 'begin' ? 'local-download' : null;
      },
    } });
  });
});

for (const mode of ['local', 'remote'] as const) for (const narrow of [false, true]) {
  test(`${mode} downloads reveal verified local content${narrow ? ' in a narrow dark window' : ''}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: narrow ? 1000 : 1674, height: 900 });
    await page.goto(`/e2e/download-manager-harness.html?collapsed${narrow ? '&dark' : ''}`);
    await page.evaluate(async selectedMode => {
      window.desktopDownloads.delay = 0;
      if (selectedMode === 'local') await window.desktopDownloads.addLocal('本地报告.md');
      else await window.desktopDownloads.addRemote('远程安装包.apk');
    }, mode);
    await page.getByRole('navigation').getByRole('button', { name: '下载管理', exact: true }).click();
    const row = page.locator('.dw-ready-row');
    const reveal = row.getByRole('button', { name: '在资源管理器中打开', exact: true });
    await expect(reveal).toBeEnabled();
    await page.getByRole('button', { name: '断开办公电脑', exact: true }).click();
    await reveal.click();
    await expect(reveal).toBeEnabled();
    const requests = await page.evaluate(() => window.downloadRevealFixture.requests);
    expect(requests[0]).toEqual({ action: 'begin', name: mode === 'local' ? '本地报告.md' : '远程安装包.apk',
      size: 8 * 1024 * 1024 });
    expect(requests.filter(request => request.action === 'write')).toHaveLength(32);
    expect(requests.at(-1)).toEqual({ action: 'reveal', id: 'local-download' });
    expect(requests.some(request => request.action === 'open')).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../../.codex-tmp/download-reveal-${mode}${narrow ? '-narrow-dark' : ''}.png`,
      fullPage: true });
    await page.evaluate(() => { window.downloadRevealFixture.fail = true; });
    await reveal.click();
    await expect(page.getByRole('alert')).toHaveText('打开未完成，请重试或保存到设备后打开。');
    await expect(reveal).toBeEnabled();
    await expect(row).toContainText('文件已就绪');
    expect(await page.evaluate(() => window.downloadRevealFixture.requests.at(-1)?.action)).toBe('cancel');
    await page.screenshot({ path: `../../.codex-tmp/download-reveal-${mode}${narrow ? '-narrow-dark' : ''}-error.png`,
      fullPage: true });
  });
}
