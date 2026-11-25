import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { checkDesktopTabs, computers, connectCaptureHosts } from '../../web/e2e/remote-desktop-tab-checks';

for (const remote of [false, true]) {
  test(`standalone remote desktop tabs in ${remote ? 'remote' : 'local'} desktop mode`, async ({ page }, info) => {
    test.slow();
    const fixture = fileURLToPath(new URL('../../web/e2e/remote-desktop-fixture.ts', import.meta.url));
    const hosts = await connectCaptureHosts(page, '/@fs/' + fixture.replaceAll('\\', '/'), 'desktopChatConnection');
    await page.addInitScript(devices => Object.assign(window, { __TAURI_INTERNALS__: {}, desktopComputers: devices }),
      computers);
    await page.setViewportSize({ width: remote ? 960 : 1440, height: 900 });
    await page.goto('/e2e/remote-desktop-tabs-harness.html' + (remote ? '?remote' : ''), { waitUntil: 'domcontentloaded' });
    await page.locator('.sidebar-tabs').getByRole('button', { name: '远程桌面', exact: true }).click();
    await checkDesktopTabs(page, hosts, info, expect);
  });
}
