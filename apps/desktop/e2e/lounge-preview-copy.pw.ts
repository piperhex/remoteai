import { expect, test, type Locator, type Page } from '@playwright/test';
import { pixel, setupLounge } from './lounge-support';
import { openLoungeAction } from './lounge-mobile-actions';

test.use({ actionTimeout: 10_000 });

async function previewImage(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 720; canvas.height = 480;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#f1f7f5'; context.fillRect(0, 0, 720, 480);
    context.fillStyle = '#147d75'; context.fillRect(0, 0, 720, 180);
    context.fillStyle = '#fff'; context.font = 'bold 40px sans-serif';
    context.fillText('在线交流 · 图片预览', 40, 100);
    context.fillStyle = '#243b39'; context.font = '28px sans-serif';
    context.fillText('右键或长按，复制当前图片', 40, 270);
    context.fillStyle = '#b7d8ce'; context.fillRect(40, 320, 640, 100);
    return canvas.toDataURL('image/jpeg');
  });
}

async function openMenu(page: Page, stage: Locator, touch: boolean) {
  await expect(page.getByRole('menu')).toBeHidden();
  if (!touch) await stage.click({ button: 'right' });
  else {
    const bounds = (await stage.boundingBox())!;
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart',
      touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }] });
    await expect(page.getByRole('menuitem', { name: '复制图片' })).toBeVisible();
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await client.detach();
  }
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText(['复制图片']);
  return menu.getByRole('menuitem', { name: '复制图片' });
}

async function expectCopiedPixels(page: Page, original: string) {
  const matches = await page.evaluate(async source => {
    const [item] = await navigator.clipboard.read();
    const copied = await item.getType('image/png');
    const sourceBlob = await (await fetch(source)).blob();
    const pixels = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0); bitmap.close();
      return canvas.toDataURL('image/png');
    };
    return await pixels(copied) === await pixels(sourceBlob);
  }, original);
  expect(matches).toBe(true);
}

for (const mode of ['local', 'remote', 'web', 'mobile']) {
  test(`${mode}: preview copies the selected original with right-click and long-press`, async ({ page, context }) => {
    const mobile = mode === 'mobile';
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const web = mode === 'web' || mobile;
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const relay = await setupLounge(page, web);
    await page.goto(web ? 'http://127.0.0.1:1486/web/' : `/e2e/lounge-harness.html?mode=${mode}`);
    await relay.ready();
    if (mobile) {
      await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
      await page.locator('.discovery-lounge').click();
      await page.getByRole('button', { name: '群聊', exact: true }).click();
    } else await page.getByRole('button', { name: '在线交流', exact: true }).click();
    const original = await previewImage(page);
    relay.push('选中第二张图片进行复制', [pixel, original]);
    const row = page.locator('.lounge-message').filter({ hasText: '选中第二张图片进行复制' });
    await row.getByRole('button', { name: '查看图片' }).nth(1).click();
    const preview = page.getByRole('dialog', { name: '查看图片' });
    const stage = preview.locator('.cs-image-stage');
    for (const touch of [false, true]) {
      await page.evaluate(() => navigator.clipboard.writeText('reset'));
      const copy = await openMenu(page, stage, touch);
      await copy.hover();
      await page.screenshot({ path: test.info().outputPath(`${mode}-${touch ? 'long-press' : 'right-click'}.png`) });
      await copy.click();
      await expect(preview.getByRole('status')).toHaveText('图片已复制');
      await expectCopiedPixels(page, original);
      await expect(page.getByRole('menu')).toBeHidden();
      await expect(preview).toBeVisible();
    }
    await page.screenshot({ path: test.info().outputPath(`${mode}-copied.png`) });
    await openMenu(page, stage, false);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(preview).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(preview).toBeHidden();
    await openLoungeAction(page, '历史记录');
    const history = page.getByRole('dialog', { name: '历史记录', exact: true });
    await history.getByRole('button', { name: '查看图片' }).nth(1).click();
    await (await openMenu(page, stage, false)).click();
    await expect(preview.getByRole('status')).toHaveText('图片已复制');
    await expectCopiedPixels(page, original);
    await expect(preview).toBeVisible();
    expect(relay.sent).toEqual([]);
  });
}

test('failed clipboard access keeps the preview open and supports retry', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const relay = await setupLounge(page, true);
  await page.goto('http://127.0.0.1:1486/web/');
  await relay.ready(); await page.getByRole('button', { name: '在线交流', exact: true }).click();
  const original = await previewImage(page);
  relay.push('', [original]);
  await page.getByRole('button', { name: '查看图片' }).click();
  const preview = page.getByRole('dialog', { name: '查看图片' });
  await page.evaluate(() => {
    const write = navigator.clipboard.write.bind(navigator.clipboard);
    navigator.clipboard.write = async () => {
      navigator.clipboard.write = write;
      throw new Error('private clipboard error');
    };
  });
  await (await openMenu(page, preview.locator('.cs-image-stage'), false)).click();
  await expect(preview.getByRole('status')).toHaveText('图片未能复制，请重试。');
  await expect(page.getByRole('menu')).toBeHidden();
  await page.screenshot({ path: test.info().outputPath('web-copy-failed.png') });
  await (await openMenu(page, preview.locator('.cs-image-stage'), false)).click();
  await expect(preview.getByRole('status')).toHaveText('图片已复制');
  await expectCopiedPixels(page, original);
});
