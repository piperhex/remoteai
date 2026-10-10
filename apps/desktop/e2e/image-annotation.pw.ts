import { expect, test, type Page } from '@playwright/test';

const editor = (page: Page) => page.frameLocator('iframe');
const snapshot = (page: Page) => editor(page).locator('canvas')
  .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
});

async function openEditor(page: Page, shape = '') {
  await page.goto(`/e2e/image-attachments-harness.html${shape}`);
  await page.getByRole('button', { name: '标注图片 1', exact: true }).click();
  await expect(editor(page).getByRole('button', { name: '完成', exact: true })).toBeEnabled();
}

async function drag(page: Page, bounds: { x: number; y: number; width: number; height: number }) {
  await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + bounds.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.7, { steps: 12 });
  await page.mouse.up();
}

test('draws an ellipse at the selected width and keeps pan/zoom out of the saved pixels', async ({ page }) => {
  await openEditor(page);
  const tools = editor(page);
  const canvas = tools.locator('canvas');
  const clean = await snapshot(page);
  await tools.getByRole('button', { name: '圆形', exact: true }).click();
  const width = tools.getByRole('slider', { name: '画笔粗细' });
  await width.focus();
  await width.press('Home');
  await width.press('ArrowRight');
  await expect(tools.locator('#stroke-width-value')).toHaveText('2 px');
  await drag(page, (await canvas.boundingBox())!);
  const marked = await snapshot(page);
  expect(marked).not.toBe(clean);
  const pixels = await canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext('2d')!;
    const pixel = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data];
    return { edge: pixel(400, 180), center: pixel(400, 300), outside: pixel(400, 175) };
  });
  expect(pixels.edge).toEqual([239, 68, 68, 255]);
  expect(pixels.center).toEqual(pixels.outside);
  await tools.getByRole('button', { name: '放大图片' }).click();
  await tools.getByRole('button', { name: '放大图片' }).click();
  await expect(tools.locator('#zoom-value')).toHaveText('150%');
  await tools.getByRole('button', { name: '拖动图片' }).click();
  const beforePan = (await canvas.boundingBox())!;
  await drag(page, (await tools.locator('#stage').boundingBox())!);
  expect((await canvas.boundingBox())!.y).toBeGreaterThan(beforePan.y);
  expect(await snapshot(page)).toBe(marked);
  await tools.getByRole('button', { name: '适应画布' }).click();
  await expect(tools.locator('#zoom-value')).toHaveText('100%');
  await tools.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await snapshot(page)).toBe(clean);
  await tools.getByRole('button', { name: '重做', exact: true }).click();
  expect(await snapshot(page)).toBe(marked);
  await tools.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('img', { name: '图片 1：截图.png' })).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
});

test('fits tall and wide photos inside the stage at common desktop sizes', async ({ page }, info) => {
  for (const [width, height] of [[1024, 600], [1280, 720], [1540, 1000]]) {
    await page.setViewportSize({ width, height });
    for (const shape of ['?tall', '?wide']) {
      await openEditor(page, shape);
      const clipped = await editor(page).locator('body').evaluate(body => {
        const stage = body.querySelector('#stage')!.getBoundingClientRect();
        const canvas = body.querySelector('canvas')!.getBoundingClientRect();
        return canvas.left < stage.left || canvas.top < stage.top
          || canvas.right > stage.right + 1 || canvas.bottom > stage.bottom + 1;
      });
      expect(clipped).toBe(false);
      expect(await editor(page).locator('.editor-panel').evaluate(panel =>
        panel.scrollHeight <= panel.clientHeight + 1)).toBe(true);
      await expect(editor(page).getByRole('button', { name: '圆形', exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`editor-${width}x${height}${shape.slice(1)}.png`) });
    }
  }
});
