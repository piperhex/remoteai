import { expect, test } from '@playwright/test';

for (const mode of ['local', 'remote']) {
  test(`${mode}: CMap-dependent PDF renders text in the file browser`, async ({ page }) => {
    const failures: string[] = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('console', message => {
      if (/Missing PDF asset|Unable to load PDF asset|translateFont failed/.test(message.text())) {
        failures.push(message.text());
      }
    });
    await page.goto(`/e2e/project-browser-harness.html?mode=${mode}&cmapPdf=1`);
    await page.getByRole('button', { name: '文件浏览', exact: true }).click();
    await expect(page.getByRole('treeitem', { name: 'cmap.pdf', exact: true })).toBeVisible();
    const cmap = page.waitForResponse(response => /UniJIS-UCS2-H.*\.bcmap/.test(response.url()));
    await page.getByRole('treeitem', { name: 'cmap.pdf', exact: true }).click();
    expect((await cmap).ok()).toBe(true);
    const canvas = page.locator('.pf-file-panel:visible canvas');
    await expect(canvas).toBeVisible();
    expect(await canvas.evaluate((element: HTMLCanvasElement) => {
      const pixels = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data;
      let ink = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 230) ink++;
      return ink;
    })).toBeGreaterThan(100);
    expect(failures).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`desktop-${mode}-cmap.png`) });
  });
}
