import { expect, test, type Page } from '@playwright/test';
import { samplePdf } from './preview-samples';

const panel = (page: Page) => page.locator('.pf-file-panel:visible');
const imageSizes = { 'tall.svg': [200, 2000], 'wide.svg': [2000, 200], 'small.svg': [100, 50] };

async function openBrowser(page: Page, options: { mode: string; inlineImages?: boolean }) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(
    `/e2e/project-browser-harness.html?mode=${options.mode}${options.inlineImages ? '&inlineImages=1' : ''}`);
  const files = Object.fromEntries(Object.entries(imageSizes).map(([name, [width, height]]) => [name,
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
      + `<rect width="100%" height="100%" fill="#14806f"/></svg>`).toString('base64')]));
  files['report.pdf'] = samplePdf().toString('base64');
  await page.evaluate(files => (window as unknown as { setPreviewFiles: (files: Record<string, string>) => void })
    .setPreviewFiles(files), files);
  await page.getByRole('button', { name: '文件浏览', exact: true }).click();
}

async function expectImageFits(page: Page, name: string) {
  const image = panel(page).getByRole('img', { name, exact: true });
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  await expect.poll(() => image.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const stage = element.parentElement!.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0 && bounds.top >= stage.top - 1 && bounds.left >= stage.left - 1
      && bounds.bottom <= stage.bottom + 1 && bounds.right <= stage.right + 1;
  })).toBe(true);
  const dimensions = await image.evaluate((element: HTMLImageElement) => ({ width: element.clientWidth,
    height: element.clientHeight, ratio: element.naturalWidth / element.naturalHeight }));
  expect(dimensions.width / dimensions.height).toBeCloseTo(dimensions.ratio, 1);
}

async function checkImageGestures(page: Page) {
  const image = panel(page).locator('.browser-image-stage img');
  const toolbar = panel(page).locator('.browser-image-toolbar');
  await toolbar.locator('button').last().click();
  await expect(toolbar).toContainText('150%');
  const before = (await image.boundingBox())!;
  const stage = (await panel(page).locator('.browser-image-stage').boundingBox())!;
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width / 2 + 50, stage.y + stage.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await image.boundingBox())!.x - before.x)).toBe(50);
  await toolbar.locator('button').nth(1).click();
  await expect(toolbar).toContainText('100%');
}

for (const mode of ['local', 'remote', 'web']) {
  for (const inlineImages of [false, true]) {
    test(`${mode}: fits tall and wide ${inlineImages ? 'inline' : 'downloaded'} images and resets after panning`,
      async ({ page }) => {
        await openBrowser(page, { mode, inlineImages });
        for (const name of Object.keys(imageSizes)) {
          await page.getByRole('treeitem', { name, exact: true }).click();
          await expectImageFits(page, name);
        }
        await page.getByRole('treeitem', { name: 'tall.svg', exact: true }).click();
        await checkImageGestures(page);
        await expectImageFits(page, 'tall.svg');
        await page.setViewportSize({ width: 1200, height: 700 });
        await expectImageFits(page, 'tall.svg');
        await page.screenshot({ path: test.info().outputPath('fitted-image.png') });
      });
  }

  test(`${mode}: PDF wheel scrolls at a fixed zoom and modifier-wheel still zooms`, async ({ page }) => {
    await openBrowser(page, { mode });
    await page.getByRole('treeitem', { name: 'report.pdf', exact: true }).click();
    const pages = panel(page).locator('.file-pdf-pages');
    const canvas = pages.locator('.file-pdf-page[data-pdf-page="1"] canvas');
    await expect(canvas).toBeVisible();
    const width = () => canvas.evaluate(element => element.getBoundingClientRect().width);
    const originalWidth = await width();
    await panel(page).locator('.file-pdf-toolbar button').last().click();
    await expect.poll(width).toBeGreaterThan(originalWidth);
    const zoomedWidth = await width();
    await pages.hover({ position: { x: 100, y: 100 } });
    await page.mouse.wheel(0, 240);
    await expect.poll(() => pages.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(await width()).toBe(zoomedWidth);
    for (const modifier of ['Control', 'Meta']) {
      const previousWidth = await width();
      await page.keyboard.down(modifier);
      await page.mouse.wheel(0, -120);
      await page.keyboard.up(modifier);
      await expect.poll(width).toBeGreaterThan(previousWidth);
    }
    await page.screenshot({ path: test.info().outputPath('scrolled-pdf.png') });
  });
}
