import { expect, test, type Page } from '@playwright/test';

const editor = (page: Page) => page.frameLocator('iframe');
const snapshot = (page: Page) => editor(page).locator('canvas')
  .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());

async function stroke(page: Page) {
  const bounds = await editor(page).locator('canvas').boundingBox();
  if (!bounds) throw new Error('Missing canvas');
  await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.6, { steps: 12 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.goto('e2e/image-editor-harness.html');
  await expect(editor(page).getByRole('button', { name: '完成', exact: true })).toBeEnabled();
});

test('erases annotations without changing the photo and supports undoable reset', async ({ page }) => {
  const clean = await snapshot(page);
  await stroke(page);
  const marked = await snapshot(page);
  expect(marked).not.toBe(clean);
  await editor(page).getByRole('button', { name: '橡皮擦', exact: true }).click();
  await stroke(page);
  expect(await snapshot(page)).toBe(clean);
  await editor(page).getByRole('button', { name: '撤销', exact: true }).click();
  expect(await snapshot(page)).toBe(marked);
  await editor(page).getByRole('button', { name: '重置', exact: true }).click();
  expect(await snapshot(page)).toBe(clean);
  await editor(page).getByRole('button', { name: '撤销', exact: true }).click();
  expect(await snapshot(page)).toBe(marked);
  await editor(page).getByRole('button', { name: '重做', exact: true }).click();
  expect(await snapshot(page)).toBe(clean);
  const original = await page.getByRole('img', { name: '保存的图片' }).getAttribute('src');
  await editor(page).getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('img', { name: '保存的图片' })).toHaveAttribute('src', original!);
});

test('adds text, custom colors and mosaic to the saved photo', async ({ page }) => {
  const clean = await snapshot(page);
  await editor(page).getByRole('button', { name: '自定义颜色', exact: true }).click();
  const colorDialog = editor(page).getByRole('dialog', { name: '自定义颜色', exact: true });
  await colorDialog.getByRole('textbox', { name: '颜色值' }).fill('#a12be4');
  await colorDialog.getByRole('button', { name: '使用颜色' }).click();
  await expect(editor(page).getByRole('button', { name: '自定义颜色' })).toHaveAttribute('aria-pressed', 'true');
  await editor(page).getByRole('button', { name: '文字', exact: true }).click();
  await editor(page).locator('canvas').click();
  const textDialog = editor(page).getByRole('dialog', { name: '添加文字' });
  await textDialog.getByRole('textbox').fill('重点\nReview this');
  await textDialog.getByRole('button', { name: '添加', exact: true }).click();
  const text = await snapshot(page);
  expect(text).not.toBe(clean);
  await editor(page).getByRole('button', { name: '马赛克', exact: true }).click();
  const width = editor(page).getByRole('slider', { name: '画笔粗细' });
  if (await width.isVisible()) { await width.focus(); await width.press('End'); }
  else await editor(page).getByRole('button', { name: '很粗', exact: true }).click();
  await stroke(page);
  const mosaic = await snapshot(page);
  expect(mosaic).not.toBe(text);
  await editor(page).getByRole('button', { name: '撤销', exact: true }).click();
  expect(await snapshot(page)).toBe(text);
  await editor(page).getByRole('button', { name: '重做', exact: true }).click();
  expect(await snapshot(page)).toBe(mosaic);
  await editor(page).getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('img', { name: '保存的图片' })).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
});

test('cancels a text dialog without closing the image editor', async ({ page }) => {
  const clean = await snapshot(page);
  await editor(page).getByRole('button', { name: '文字', exact: true }).click();
  await editor(page).locator('canvas').click();
  await editor(page).getByRole('textbox', { name: '标注文字' }).fill('Discard this');
  await page.keyboard.press('Escape');
  await expect(editor(page).getByRole('dialog')).not.toBeVisible();
  await expect(editor(page).getByRole('button', { name: '完成', exact: true })).toBeEnabled();
  expect(await snapshot(page)).toBe(clean);
});

test('undoes one action per shortcut press and leaves text undo in the text dialog', async ({ page }) => {
  const clean = await snapshot(page);
  await stroke(page);
  const first = await snapshot(page);
  await editor(page).getByRole('button', { name: '蓝色', exact: true }).click();
  await stroke(page);
  expect(await snapshot(page)).not.toBe(first);
  await page.keyboard.down('Control');
  await page.keyboard.down('z');
  expect(await snapshot(page)).toBe(first);
  await page.keyboard.down('z');
  expect(await snapshot(page)).toBe(first);
  await page.keyboard.up('z');
  await page.keyboard.up('Control');
  await page.keyboard.press('Control+z');
  expect(await snapshot(page)).toBe(clean);
  await editor(page).getByRole('button', { name: '重做', exact: true }).click();
  expect(await snapshot(page)).toBe(first);
  await page.keyboard.press('Meta+z');
  expect(await snapshot(page)).toBe(clean);
  await stroke(page);
  const marked = await snapshot(page);
  await editor(page).getByRole('button', { name: '文字', exact: true }).click();
  await editor(page).locator('canvas').click();
  const text = editor(page).getByRole('textbox', { name: '标注文字' });
  await text.pressSequentially('Undo this text');
  await text.press('Control+z');
  await expect(text).toHaveValue('');
  expect(await snapshot(page)).toBe(marked);
  await page.keyboard.press('Escape');
  await editor(page).getByRole('button', { name: '重置', exact: true }).click();
  expect(await snapshot(page)).toBe(clean);
  await page.keyboard.press('Control+z');
  expect(await snapshot(page)).toBe(marked);
});

async function expectLayoutFits(page: Page) {
  const frame = page.locator('iframe');
  const viewport = page.viewportSize()!;
  const bounds = (await frame.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
  const clipped = await editor(page).locator('body').evaluate(body => {
    const view = body.ownerDocument.defaultView!;
    return [...body.querySelectorAll('button, input[type="range"], canvas, #notice')].filter(element => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      const panel = element.closest('.editor-panel')?.getBoundingClientRect();
      if (panel && (rect.top < panel.top || rect.bottom > panel.bottom + 1)) return true;
      return rect.left < 0 || rect.top < 0 || rect.right > view.innerWidth + 1 || rect.bottom > view.innerHeight + 1;
    }).map(element => element.id || element.getAttribute('aria-label') || element.textContent);
  });
  expect(clipped).toEqual([]);
  const canvas = (await editor(page).locator('canvas').boundingBox())!;
  expect(canvas.width).toBeGreaterThan(50);
  expect(canvas.height).toBeGreaterThan(50);
  const stage = (await editor(page).locator('#stage').boundingBox())!;
  expect(canvas.x).toBeGreaterThanOrEqual(stage.x);
  expect(canvas.y).toBeGreaterThanOrEqual(stage.y);
  expect(canvas.x + canvas.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
  expect(canvas.y + canvas.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
}

test('keeps the photo and every control visible on phones, landscape and short PC windows', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Run the viewport matrix once');
  for (const [width, height] of [[320, 568], [390, 844], [430, 932], [667, 375], [844, 390],
    [768, 600], [1024, 600], [1280, 720], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    for (const shape of ['', '?wide']) {
      await page.goto(`e2e/image-editor-harness.html${shape}`);
      await expect(editor(page).getByRole('button', { name: '完成', exact: true })).toBeEnabled();
      await expectLayoutFits(page);
    }
    await page.goto('e2e/image-editor-harness.html');
    await expect(editor(page).getByRole('button', { name: '完成', exact: true })).toBeEnabled();
    await page.screenshot({ path: info.outputPath(`editor-${width}x${height}.png`) });
  }
});

test('fits English controls in a narrow phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('e2e/image-editor-harness.html?english');
  await expect(editor(page).getByRole('button', { name: 'Done', exact: true })).toBeEnabled();
  await expectLayoutFits(page);
  await expect(editor(page).getByRole('button', { name: 'Reset', exact: true })).toBeVisible();
});

test('preserves annotations and settings when switching between PC and phone layouts', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Run the resize regression once');
  const tools = editor(page);
  await expect(tools.getByRole('button', { name: '圆形', exact: true })).toBeVisible();
  const panel = (await tools.locator('.editor-panel').boundingBox())!;
  const stage = (await tools.locator('#stage').boundingBox())!;
  expect(panel.x).toBeGreaterThan(stage.x + stage.width);
  await tools.getByRole('slider', { name: '画笔粗细' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tools.locator('#stroke-width-value')).toHaveText('5 px');
  await stroke(page);
  const marked = await snapshot(page);
  await tools.getByRole('button', { name: '放大图片' }).click();
  await tools.getByRole('button', { name: '拖动图片' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(tools.getByRole('button', { name: '画笔', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expectLayoutFits(page);
  expect(await snapshot(page)).toBe(marked);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(tools.getByRole('slider', { name: '画笔粗细' })).toHaveValue('5');
  await expect(tools.locator('#zoom-value')).toHaveText('100%');
  expect(await snapshot(page)).toBe(marked);
  await tools.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await snapshot(page)).not.toBe(marked);
});
