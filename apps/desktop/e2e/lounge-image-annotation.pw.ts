import { expect, test, type Page } from '@playwright/test';
import { pixel, setupLounge } from './lounge-support';

async function draw(page: Page) {
  const canvas = page.frameLocator('.chat-image-editor iframe').locator('canvas');
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.8, { steps: 8 });
  await page.mouse.up();
}

async function prepareImages(page: Page, mode: string) {
  const composer = page.locator('.lounge-composer');
  const file = { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(pixel.split(',')[1], 'base64') };
  await composer.locator('input[type=file]').setInputFiles(file);
  const images = composer.locator('.lounge-attachments img');
  const annotate = composer.getByRole('button', { name: '标注图片 1', exact: true });
  const add = composer.getByRole('button', { name: '继续添加图片', exact: true });
  const imageBox = (await images.first().boundingBox())!;
  const editBox = (await annotate.boundingBox())!;
  const addBox = (await add.boundingBox())!;
  expect(imageBox.width).toBe(imageBox.height);
  expect(editBox.y + editBox.height).toBeCloseTo(imageBox.y + imageBox.height);
  expect(editBox.width).toBe(imageBox.width);
  expect(addBox.y).toBe(imageBox.y);
  expect(addBox.width).toBe(imageBox.width);
  await composer.screenshot({ path: test.info().outputPath(`${mode}-single.png`) });
  const picker = page.waitForEvent('filechooser');
  await add.click();
  await (await picker).setFiles([file, { ...file, name: 'another.png' }]);
  await expect(images).toHaveCount(3);
  await expect(add).toHaveCount(0);
  await composer.getByRole('button', { name: '移除图片 3', exact: true }).click();
  await expect(add).toBeVisible();
  return { images, annotate };
}

async function checkEnlargedDraft(page: Page, mode: string) {
  await page.setViewportSize({ width: 940, height: 760 });
  await page.evaluate(() => {
    localStorage.setItem('codex-switch:global-font-size', '21');
    window.dispatchEvent(new Event('storage'));
  });
  const composer = page.locator('.lounge-composer');
  const edit = composer.getByRole('button', { name: '标注图片 1', exact: true });
  await expect(edit).toHaveCSS('font-size', '18px');
  await expect(edit).toBeInViewport();
  await expect(composer.getByRole('button', { name: '继续添加图片', exact: true })).toBeInViewport();
  await composer.screenshot({ path: test.info().outputPath(`${mode}-narrow-large-text.png`) });
}

for (const mode of ['local', 'remote', 'web', 'mobile-320', 'mobile-390']) {
  test(`${mode}: annotate, cancel and send only the edited attachment`, async ({ page }) => {
    const mobile = mode.startsWith('mobile');
    const web = mode === 'web' || mobile;
    if (mobile) await page.setViewportSize({ width: Number(mode.split('-')[1]), height: 844 });
    const relay = await setupLounge(page, web);
    await page.goto(web ? 'http://127.0.0.1:1486/web/' : `/e2e/lounge-harness.html?mode=${mode}`);
    await relay.ready();
    if (mobile) {
      await page.getByRole('tab', { name: '发现', exact: true }).click();
      await page.getByRole('button', { name: '在线交流', exact: true }).click();
      await page.getByRole('button', { name: '群聊', exact: true }).click();
    } else await page.getByRole('button', { name: '在线交流', exact: true }).click();
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    const { images, annotate } = await prepareImages(page, mode);
    if (!mobile) await checkEnlargedDraft(page, mode);
    await input.fill('保留文字和第二张图片');
    const frame = page.frameLocator('.chat-image-editor iframe');
    await annotate.click();
    await expect(frame.locator('#done')).toBeEnabled();
    await draw(page);
    await frame.locator('#cancel').click();
    await expect(page.locator('.chat-image-editor iframe')).toHaveCount(0);
    await expect(images.nth(0)).toHaveAttribute('src', pixel);
    await annotate.click();
    await expect(frame.locator('#done')).toBeEnabled();
    await draw(page);
    await expect(frame.locator('#undo')).toBeEnabled();
    await page.screenshot({ path: test.info().outputPath(`${mode}-annotation.png`) });
    await frame.locator('#done').click();
    await expect(images.nth(0)).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
    const marked = await images.nth(0).getAttribute('src');
    await expect(images.nth(1)).toHaveAttribute('src', pixel);
    await expect(input).toHaveValue('保留文字和第二张图片');
    await page.screenshot({ path: test.info().outputPath(`${mode}-draft.png`) });
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => relay.sent.length).toBe(1);
    expect(relay.sent[0].images).toEqual([marked, pixel]);
    expect(Buffer.from(marked!.split(',')[1], 'base64').byteLength).toBeLessThanOrEqual(1024 * 1024);
    await expect(images).toHaveCount(0);
  });
}
