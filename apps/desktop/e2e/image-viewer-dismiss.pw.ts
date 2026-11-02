import { expect, test, type Page } from '@playwright/test';

async function openPreview(page: Page) {
  await page.getByRole('button', { name: '放大查看：拖动测试', exact: true }).click();
  await expect.poll(() => page.locator('.cs-image-stage img')
    .evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
}

async function dragBackgroundAndReturn(page: Page) {
  await page.mouse.move(20, 30);
  await page.mouse.down();
  await page.mouse.move(120, 60, { steps: 5 });
  await page.mouse.move(20, 30, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.cs-image-viewer')).toBeVisible();
}

for (const mode of ['local', 'remote', 'web']) {
  for (const width of [1280, mode === 'web' ? 870 : 780]) {
    test(`${mode} ${width}: background clicks close without interrupting image gestures`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.route('https://fonts.googleapis.com/**', route => route.abort());
      await page.goto(`/e2e/image-viewer-drag-harness.html?mode=${mode}&linked`);
      const preview = page.locator('.cs-image-viewer');
      await openPreview(page);
      await page.mouse.click(width / 2, 450);
      await expect(preview).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${mode}-${width}-preview.png`) });
      // This is inside the full-size <img> box, but above its visible object-fit content.
      await page.mouse.click(20, 30);
      await expect(preview).toHaveCount(0);
      await expect(page).not.toHaveURL(/#image$/);
      await page.screenshot({ path: info.outputPath(`${mode}-${width}-dismissed.png`) });
      await openPreview(page);
      await dragBackgroundAndReturn(page);
      await page.getByRole('button', { name: '放大图片', exact: true }).click();
      await page.getByRole('button', { name: '旋转图片', exact: true }).click();
      await page.getByRole('button', { name: '缩小图片', exact: true }).click({ clickCount: 2 });
      await page.mouse.click(width / 2, 450);
      await expect(preview).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${mode}-${width}-transformed.png`) });
      await page.mouse.click(width - 20, 450);
      await expect(preview).toHaveCount(0);
    });
  }
}
