import { expect, test } from '@playwright/test';
import type { desktopTest } from './remote-desktop-fixture';
declare global { interface Window { desktopTest: typeof desktopTest } }

test('Mac hosts use Command shortcuts and Option keys on narrow and wide viewers', async ({ page }, info) => {
  await page.goto('e2e/remote-desktop-harness.html?touch&macos');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '键盘', exact: true }).click();
  await page.getByRole('tab', { name: '快捷键', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Win+L 锁定屏幕', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cmd+C 复制', exact: true }).click();
  await page.getByRole('button', { name: 'Ctrl+Cmd+Q 锁定屏幕', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.desktopTest.inputs)).toEqual([
    { kind: 'keyboard', code: 'MetaLeft', down: true }, { kind: 'keyboard', code: 'KeyC', down: true },
    { kind: 'keyboard', code: 'KeyC', down: false }, { kind: 'keyboard', code: 'MetaLeft', down: false },
    { kind: 'keyboard', code: 'ControlLeft', down: true }, { kind: 'keyboard', code: 'MetaLeft', down: true },
    { kind: 'keyboard', code: 'KeyQ', down: true }, { kind: 'keyboard', code: 'KeyQ', down: false },
    { kind: 'keyboard', code: 'MetaLeft', down: false }, { kind: 'keyboard', code: 'ControlLeft', down: false },
  ]);
  await page.screenshot({ path: info.outputPath('mac-shortcuts.png') });
  await page.getByRole('tab', { name: '电脑键盘', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cmd', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Option', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Win', exact: true })).toHaveCount(0);
  await expect(page.locator('.rd-keyboard')).toHaveJSProperty('scrollWidth',
    await page.locator('.rd-keyboard').evaluate(element => element.clientWidth));
});
