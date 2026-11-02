import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openLoungeAction } from './lounge-mobile-actions';
import { setupLounge } from './lounge-support';

async function portraitImage(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 720; canvas.height = 1200;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#f8faf9'; context.fillRect(0, 0, 720, 1200);
    context.fillStyle = '#147d75'; context.fillRect(0, 0, 720, 280);
    context.fillStyle = '#fff'; context.font = 'bold 42px sans-serif';
    context.fillText('在线交流', 48, 120);
    context.font = '24px sans-serif'; context.fillText('图片预览 · Portrait image', 48, 176);
    context.fillStyle = '#243b39'; context.font = '32px sans-serif';
    context.fillText('分享一张长图', 48, 368);
    for (let row = 0; row < 9; row++) {
      context.fillStyle = row % 2 ? '#dbe7e3' : '#e7efec';
      context.fillRect(48, 420 + row * 72, row % 3 ? 624 : 432, 24);
    }
    return canvas.toDataURL('image/png');
  });
}

async function expectFullscreenPreview(page: Page, preview: Locator) {
  const viewport = page.viewportSize()!;
  expect(await preview.boundingBox()).toEqual({ x: 0, y: 0, ...viewport });
  await expect(preview).toHaveCSS('padding', '0px');
  await expect(preview).toHaveCSS('border-width', '0px');
  await expect(preview.locator('.cs-image-stage')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(preview.getByRole('button')).toHaveCount(6);
  await expect(preview.locator('.cs-image-ai, .cs-image-original')).toHaveCount(0);
  const save = preview.getByRole('button', { name: '下载图片', exact: true });
  await expect(save).toBeInViewport();
  const saveBounds = (await save.boundingBox())!;
  expect(saveBounds.x).toBeGreaterThan(viewport.width / 2);
  expect(saveBounds.y).toBeLessThan(60);
  const image = (await preview.locator('img').boundingBox())!;
  expect(image.height).toBeLessThanOrEqual(viewport.height);
  expect(image.width / image.height).toBeCloseTo(720 / 1200, 2);
  expect(image.x + image.width / 2).toBeCloseTo(viewport.width / 2, 0);
  expect(image.y + image.height / 2).toBeCloseTo(viewport.height / 2, 0);
}

async function expectOriginalDownload(page: Page, preview: Locator, uri: string) {
  const downloading = page.waitForEvent('download');
  await preview.getByRole('button', { name: '下载图片', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('RemoteAI-image.png');
  expect(await readFile((await download.path())!)).toEqual(Buffer.from(uri.split(',')[1], 'base64'));
  await expect(preview).toBeVisible();
}

async function pinchAndPan(page: Page, stage: Locator) {
  const bounds = (await stage.boundingBox())!;
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const client = await page.context().newCDPSession(page);
  const fingers = (spread: number) => [-1, 1].map((direction, id) => ({ id,
    x: center.x + direction * spread, y: center.y }));
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(30) });
  for (const spread of [40, 50, 60]) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(spread) });
  }
  await expect(page.locator('.cs-image-toolbar')).toContainText('200%');
  const image = stage.locator('img');
  const before = (await image.boundingBox())!;
  // Continue dragging with the remaining finger after a pinch without jumping or dismissing the preview.
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [fingers(60)[1]] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove',
    touchPoints: [{ ...fingers(60)[0], x: center.x - 30, y: center.y + 35 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => Math.round((await image.boundingBox())!.x - before.x)).toBe(30);
  await expect.poll(async () => Math.round((await image.boundingBox())!.y - before.y)).toBe(35);
  await expect(stage).toBeVisible();
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(60) });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(30) });
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(page.locator('.cs-image-toolbar')).toContainText('100%');
  await client.detach();
}

for (const mode of ['local', 'remote', 'web', 'mobile']) {
  test(`${mode}: sent images support pinch, pan, reset and history preview`, async ({ page }) => {
    const mobile = mode === 'mobile';
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const relay = await setupLounge(page, mode === 'web' || mobile);
    await page.goto(mode === 'web' || mobile ? 'http://127.0.0.1:1486/web/' : `/e2e/lounge-harness.html?mode=${mode}`);
    await relay.ready();
    if (mobile) {
      await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
      await page.locator('.discovery-lounge').click();
      await page.getByRole('button', { name: '群聊', exact: true }).click();
    } else await page.getByRole('button', { name: '在线交流', exact: true }).click();
    const portrait = await portraitImage(page);
    await page.locator('.lounge-composer input[type=file]').setInputFiles({
      name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(portrait.split(',')[1], 'base64'),
    });
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => relay.sent.length).toBe(1);
    await page.locator('.lounge-message.is-own').getByRole('button', { name: '查看图片' }).click();
    const preview = page.getByRole('dialog', { name: '查看图片' });
    const stage = preview.locator('.cs-image-stage');
    await expect(stage.locator('img')).toBeVisible();
    await expectFullscreenPreview(page, preview);
    await expectOriginalDownload(page, preview, portrait);
    await page.mouse.click(page.viewportSize()!.width / 2, page.viewportSize()!.height / 2);
    await expect(preview).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`${mode}-fullscreen-preview.png`) });
    await page.mouse.click(20, 75);
    await expect(preview).toBeHidden();
    await page.screenshot({ path: test.info().outputPath(`${mode}-background-dismissed.png`) });
    await page.locator('.lounge-message.is-own').getByRole('button', { name: '查看图片' }).click();
    await expect(stage).toBeVisible();
    await stage.hover();
    await pinchAndPan(page, stage);
    await preview.getByRole('button', { name: '放大图片', exact: true }).click();
    await expect(preview.locator('.cs-image-toolbar')).toContainText('150%');
    await page.screenshot({ path: test.info().outputPath(`${mode}-image-preview.png`) });
    await preview.getByRole('button', { name: '还原图片', exact: true }).click();
    await expect(preview.locator('.cs-image-toolbar')).toContainText('100%');
    await stage.hover(); await page.mouse.wheel(0, -100);
    await expect(preview.locator('.cs-image-toolbar')).toContainText('120%');
    await page.keyboard.press('Escape'); await expect(preview).toBeHidden();
    await openLoungeAction(page, '历史记录');
    await page.getByRole('dialog', { name: '历史记录', exact: true }).getByRole('button', { name: '查看图片' }).click();
    await expect(stage).toBeVisible(); await stage.hover();
    await pinchAndPan(page, stage);
    await expectOriginalDownload(page, preview, portrait);
    await page.mouse.click(20, 75);
    await expect(preview).toBeHidden();
    await expect(page.getByRole('dialog', { name: '历史记录', exact: true })).toBeVisible();
  });
}
