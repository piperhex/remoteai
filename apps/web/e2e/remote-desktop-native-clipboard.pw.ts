import { expect, test } from '@playwright/test';
import type { desktopTest } from './remote-desktop-fixture';

declare global { interface Window { desktopTest: typeof desktopTest } }

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'The desktop viewer uses a physical keyboard and native clipboard.');
  await page.goto('e2e/remote-desktop-harness.html?native-clipboard');
  await page.getByRole('button', { name: '打开远程桌面', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  await page.locator('.rd-touch').click();
  await expect(page.locator('.rd-key-capture')).toBeFocused();
});

test('Ctrl+V and Shift+Insert send native file entries once and keep focus on the desktop', async ({ page }) => {
  const content = { format: 'files' as const, files: [
    { name: '报告.txt', data: Buffer.from('local → remote').toString('base64') },
    { name: 'second.bin', data: 'AAECAw==' },
  ] };
  await page.evaluate(content => { window.desktopTest.localClipboard.content = content; }, content);
  await page.keyboard.press('Control+v');
  await expect.poll(() => page.evaluate(() => window.desktopTest.clipboard.pastes)).toBe(1);
  expect(await page.evaluate(() => window.desktopTest.clipboard.content)).toEqual(content);
  await page.keyboard.press('Shift+Insert');
  await expect.poll(() => page.evaluate(() => window.desktopTest.clipboard.pastes)).toBe(2);
  expect(await page.evaluate(() => window.desktopTest.localClipboard.calls)).toEqual(['read', 'read']);
  await expect(page.getByRole('complementary', { name: '剪贴板' })).toHaveCount(0);
  await expect(page.locator('.rd-key-capture')).toBeFocused();
});

test('Ctrl+C copies remote files into the native clipboard without downloads or panel interaction', async ({ page }) => {
  const downloads: string[] = []; page.on('download', download => downloads.push(download.suggestedFilename()));
  const content = { format: 'files' as const, files: [{ name: 'remote.txt', data: 'cmVtb3Rl' }] };
  await page.evaluate(content => { window.desktopTest.clipboard.content = content; }, content);
  await page.keyboard.press('Control+c');
  await expect.poll(() => page.evaluate(() => window.desktopTest.localClipboard.content)).toEqual(content);
  await expect(page.getByText('已复制到本机，可直接粘贴。')).toBeVisible();
  await expect(page.getByRole('complementary', { name: '剪贴板' })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  expect(await page.evaluate(() => window.desktopTest.localClipboard.content)).toEqual(content);
  expect(downloads).toEqual([]);
});

test('an immediate paste waits for a remote copy instead of sending the previous local clipboard', async ({ page }) => {
  await page.evaluate(() => { window.desktopTest.localClipboard.delay = 500; });
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect.poll(() => page.evaluate(() => window.desktopTest.clipboard.pastes)).toBe(1);
  expect(await page.evaluate(() => window.desktopTest.clipboard.content))
    .toEqual({ format: 'text', text: 'Remote clipboard 测试' });
  expect(await page.evaluate(() => window.desktopTest.localClipboard.calls)).toEqual(['write', 'read']);
  await expect(page.getByRole('complementary', { name: '剪贴板' })).toHaveCount(0);
});

test('native text and PNG images transfer in both directions with regular copy and paste', async ({ page }) => {
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const contents = [{ format: 'text' as const, text: '双向文本\nsecond line' }, { format: 'image' as const, data: png }];
  for (const [index, content] of contents.entries()) {
    await page.evaluate(content => { window.desktopTest.localClipboard.content = content; }, content);
    await page.keyboard.press('Control+v');
    await expect.poll(() => page.evaluate(() => window.desktopTest.clipboard.pastes)).toBe(index + 1);
    expect(await page.evaluate(() => window.desktopTest.clipboard.content)).toEqual(content);
    await page.evaluate(() => { window.desktopTest.localClipboard.content = { format: 'text', text: '' }; });
    await page.keyboard.press('Control+c');
    await expect.poll(() => page.evaluate(() => window.desktopTest.localClipboard.content)).toEqual(content);
  }
});
