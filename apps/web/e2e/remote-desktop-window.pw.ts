import { expect, test, type Page } from '@playwright/test';
import type { desktopTest } from './remote-desktop-fixture';

declare global { interface Window { desktopTest: typeof desktopTest } }

test.beforeEach(({ isMobile }) => {
  test.skip(!!isMobile, 'Window controls are for viewers with a physical mouse.');
});

async function openDesktop(page: Page, native = false, query = '') {
  await page.goto(`e2e/remote-desktop-harness.html?displays${native ? '&native-clipboard' : ''}${query}`);
  if (!native) await page.getByRole('button', { name: '打开工具', exact: true }).click();
  await page.getByRole('button', { name: native ? '打开远程桌面' : '远程桌面', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  await expect(page.getByText('正在连接桌面…', { exact: true })).not.toBeVisible();
}

for (const native of [false, true]) {
  test(`minimizes and restores the same session in the ${native ? 'desktop client' : 'PC browser'}`,
    async ({ page }, info) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await openDesktop(page, native);
      const controls = page.getByRole('group', { name: '远程桌面窗口操作' });
      await expect(controls.getByRole('button')).toHaveCount(3);
      const spacer = page.locator('.rd-titlebar-space');
      expect(await spacer.getAttribute('data-tauri-drag-region')).toBe(native ? 'true' : null);
      await expect(controls.locator('[data-tauri-drag-region]')).toHaveCount(0);
      const titlebar = (await page.locator('.rd-titlebar').boundingBox())!;
      const buttons = (await controls.boundingBox())!;
      expect(buttons.x + buttons.width).toBe(1440);
      expect(buttons.y).toBe(titlebar.y);
      expect((await spacer.boundingBox())!.width).toBeGreaterThan(32);
      await page.screenshot({ path: info.outputPath('remote-desktop-titlebar.png') });
      const video = await page.locator('video').elementHandle();
      await page.getByRole('button', { name: '最小化', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '远程桌面', exact: true })).not.toBeVisible();
      const restore = page.getByRole('button', { name: '恢复远程桌面', exact: true });
      await expect(restore).toBeVisible();
      const launcher = (await restore.boundingBox())!;
      if (native) {
        const connection = (await page.locator('.chat-connection-info').boundingBox())!;
        const header = (await page.locator('.chat-header').boundingBox())!;
        expect(launcher.x + launcher.width).toBeLessThan(connection.x);
        expect(launcher.y).toBeGreaterThanOrEqual(header.y);
        expect(launcher.y + launcher.height).toBeLessThanOrEqual(header.y + header.height);
        const status = restore.getByRole('status', { name: '正在后台运行' });
        await expect(status).toBeVisible();
        await expect(status).toHaveCSS('background-color', 'rgb(34, 197, 94)');
        expect((await status.boundingBox())!.x).toBeGreaterThan((await restore.locator('svg').boundingBox())!.x);
        await expect(page.locator('.rd-restore')).toHaveCount(0);
      } else {
        expect(launcher.x + launcher.width).toBe(1416);
        expect(launcher.y + launcher.height).toBe(876);
      }
      await page.screenshot({ path: info.outputPath('remote-desktop-minimized.png') });
      await page.getByRole('textbox', { name: '本机聊天消息' }).click();
      const before = await page.evaluate(() => ({ frames: window.desktopTest.frames,
        inputs: window.desktopTest.inputs.length }));
      await page.keyboard.type('local chat');
      await expect.poll(() => page.evaluate(() => window.desktopTest.frames)).toBeGreaterThan(before.frames);
      expect(await page.evaluate(() => window.desktopTest.inputs.length)).toBe(before.inputs);
      expect(await page.evaluate(() => window.desktopTest.closed)).toBe(0);
      await restore.click();
      await expect(page.getByRole('status', { name: '正在后台运行' })).toHaveCount(0);
      await expect(page.getByRole('dialog', { name: '远程桌面', exact: true })).toBeVisible();
      expect(await video!.evaluate(element => element === document.querySelector('video'))).toBe(true);
      await page.keyboard.press('a');
      await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
        .toMatchObject({ kind: 'keyboard', code: 'KeyA', down: false });
      expect(await page.evaluate(() => window.desktopTest.captures)).toBe(1);
      await page.getByRole('button', { name: '关闭', exact: true }).click();
      await expect(page.locator('.rd-root')).toHaveCount(0);
      await expect(restore).toHaveCount(0);
      if (native) await expect(page.getByRole('button', { name: '打开远程桌面', exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.desktopTest.closed)).toBe(1);
      expect(errors).toEqual([]);
    });
}

test('fullscreen contains only the remote viewer and exits when minimizing or closing', async ({ page }) => {
  await openDesktop(page, true);
  const fullscreen = page.getByRole('button', { name: '全屏', exact: true });
  const exit = page.getByRole('button', { name: '退出全屏', exact: true });
  await fullscreen.click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className)).toBe('rd-root');
  await expect(exit).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.rd-titlebar-space')).not.toHaveAttribute('data-tauri-drag-region');
  await exit.click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await expect(page.locator('.rd-titlebar-space')).toHaveAttribute('data-tauri-drag-region', 'true');
  await fullscreen.click();
  await expect(exit).toBeEnabled();
  await page.getByRole('button', { name: '最小化', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复远程桌面' })).toBeVisible();
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await page.getByRole('button', { name: '恢复远程桌面' }).click();
  await fullscreen.click();
  await expect(exit).toBeEnabled();
  // The browser can leave fullscreen independently, for example when the user presses Escape.
  await page.evaluate(() => document.exitFullscreen());
  await expect(fullscreen).toHaveAttribute('aria-pressed', 'false');
  await fullscreen.click();
  await expect(exit).toBeEnabled();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.desktopTest.closed)).toBe(1);
});

test('keeps window controls visible in a narrow window with display tabs', async ({ page }, info) => {
  await page.setViewportSize({ width: 560, height: 700 });
  await openDesktop(page, true);
  const controls = page.getByRole('group', { name: '远程桌面窗口操作' });
  const bar = page.getByRole('navigation', { name: '显示器', exact: true });
  const bounds = (await controls.boundingBox())!;
  expect(bounds.x + bounds.width).toBe(560);
  expect((await bar.boundingBox())!.x + (await bar.boundingBox())!.width).toBeLessThanOrEqual(bounds.x - 32);
  await expect(controls.getByRole('button', { name: '最小化' })).toBeInViewport();
  await expect(controls.getByRole('button', { name: '关闭' })).toBeInViewport();
  expect(await page.locator('.rd-root').evaluate(node => node.scrollWidth === node.clientWidth)).toBe(true);
  await page.getByRole('button', { name: '最小化', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复远程桌面', exact: true })).toBeInViewport();
  expect(await page.locator('.chat-header').evaluate(node => node.scrollWidth === node.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('remote-desktop-narrow.png') });
});

test('reports fullscreen errors and keeps minimizing and closing available', async ({ page }) => {
  await openDesktop(page);
  await page.locator('.rd-root').evaluate(element => {
    element.requestFullscreen = () => Promise.reject(new Error('Fixture fullscreen denial'));
  });
  await page.getByRole('button', { name: '全屏', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('暂时无法切换全屏，请重试。');
  await page.getByRole('button', { name: '最小化', exact: true }).click();
  await page.getByRole('button', { name: '恢复远程桌面' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.closed)).toBe(1);
});

test('keeps the viewer visible if leaving fullscreen fails', async ({ page }) => {
  await openDesktop(page, true);
  await page.getByRole('button', { name: '全屏', exact: true }).click();
  await expect(page.getByRole('button', { name: '退出全屏', exact: true })).toBeEnabled();
  await page.evaluate(() => {
    document.exitFullscreen = () => Promise.reject(new Error('Fixture exit denial'));
  });
  await page.getByRole('button', { name: '最小化', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('暂时无法退出全屏，请重试。');
  await expect(page.getByRole('dialog', { name: '远程桌面', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '恢复远程桌面' })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.desktopTest.closed)).toBe(1);
});

test('keeps the desktop titlebar available on a touch-only Windows device', async ({ page }) => {
  await openDesktop(page, true, '&touch');
  await expect(page.locator('.rd-titlebar-space')).toHaveAttribute('data-tauri-drag-region', 'true');
  await expect(page.getByRole('group', { name: '远程桌面窗口操作' }).getByRole('button')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '切换为触屏模式' })).toBeVisible();
  await page.getByRole('button', { name: '最小化', exact: true }).click();
  await page.getByRole('button', { name: '恢复远程桌面' }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.closed)).toBe(1);
});
