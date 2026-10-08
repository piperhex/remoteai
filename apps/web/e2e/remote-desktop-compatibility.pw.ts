import { expect, test, type Page } from '@playwright/test';

async function openDesktop(page: Page) {
  await page.goto('e2e/remote-desktop-harness.html?layout-only');
  await page.getByRole('button', { name: '打开工具' }).click();
  await page.getByRole('button', { name: '远程桌面', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '远程桌面' })).toBeVisible();
}

test('keeps unsupported fullscreen unavailable on desktop, iPhone and iPad', async ({ page, isMobile }, info) => {
  await page.addInitScript(() => Object.defineProperty(document, 'fullscreenEnabled', { value: false }));
  await openDesktop(page);
  const fullscreen = page.getByRole('button', { name: '全屏', exact: true });
  if (isMobile) await expect(fullscreen).toHaveCount(0);
  else await expect(fullscreen).toBeDisabled();
  await expect(page.getByRole('button', { name: '键盘', exact: true })).toBeVisible();
  const dialog = (await page.getByRole('dialog', { name: '远程桌面' }).boundingBox())!;
  expect(dialog.x).toBe(0); expect(dialog.y).toBe(0);
  expect(dialog.width).toBe(page.viewportSize()!.width);
  expect(dialog.height).toBe(page.viewportSize()!.height);
  await page.screenshot({ path: info.outputPath('desktop-apple-layout.png') });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '远程桌面' })).toHaveCount(0);
});

test('keeps text and display inputs within the keyboard viewport without focus zoom', async ({ page }) => {
  await page.addInitScript(() => {
    // iOS changes visualViewport instead of the layout viewport when the keyboard appears.
    const viewport = new EventTarget();
    Object.assign(viewport, { height: innerHeight, offsetTop: 0 });
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
  });
  await openDesktop(page);
  for (const label of ['键盘', '显示']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.evaluate(() => {
      Object.assign(window.visualViewport!, { height: 180, offsetTop: 20 });
      window.visualViewport!.dispatchEvent(new Event('resize'));
      window.visualViewport!.dispatchEvent(new Event('scroll'));
    });
    const dialog = page.getByRole('dialog', { name: '远程桌面' });
    await expect.poll(async () => (await dialog.boundingBox())!.height).toBe(180);
    expect((await dialog.boundingBox())!.y).toBe(20);
    const input = label === '键盘' ? page.getByRole('textbox', { name: '发送到电脑的文字' })
      : page.getByRole('spinbutton', { name: '自定义帧率' });
    await input.scrollIntoViewIfNeeded(); await input.focus();
    expect(await input.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    const bounds = (await input.boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(20);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(200);
  }
});
