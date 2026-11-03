import { expect, test } from '@playwright/test';

for (const mode of ['local', 'remote', 'web']) {
  for (const dark of [false, true]) {
    const scenario = `${mode} ${dark ? 'dark narrow' : 'light wide'} preview covers browser and restores it`;
    test(scenario, async ({ page }, info) => {
      await page.setViewportSize({ width: dark ? 1024 : 1440, height: 900 });
      await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
      await page.route('**/preview-site/**', route => route.fulfill({ contentType: 'text/html', body:
        '<body style="background:#f5faf6;color:#254a3b;padding:28px;font:16px sans-serif">'
        + '<h1>网页预览</h1><label>备注 <input aria-label="备注"></label></body>' }));
      await page.goto(`/e2e/image-browser-layer-harness.html?mode=${mode}${dark ? '&dark=1' : ''}`,
        { waitUntil: 'domcontentloaded' });
      const note = page.frameLocator('iframe').getByRole('textbox', { name: '备注' });
      await note.fill('保留浏览内容');
      const preview = page.locator('.cs-image-viewer');
      const open = page.getByRole('button', { name: '放大查看：预览示例', exact: true });
      await open.click();
      await expect(preview).toBeVisible();
      expect(await preview.evaluate(dialog => dialog.matches(':modal'))).toBe(true);
      const browser = await page.locator('.pm-browser-surface').boundingBox();
      expect(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.cs-image-viewer')),
        { x: browser!.x + browser!.width / 2, y: browser!.y + browser!.height / 2 })).toBe(true);
      await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark-narrow' : 'light-wide'}-preview.png`) });
      await page.getByRole('button', { name: '放大图片', exact: true }).click();
      await page.getByRole('button', { name: '关闭图片', exact: true }).click();
      await expect(preview).toHaveCount(0);
      await expect(note).toHaveValue('保留浏览内容');
      await open.click(); await page.keyboard.press('Escape');
      await expect(preview).toHaveCount(0);
      await expect(note).toHaveValue('保留浏览内容');
      await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark-narrow' : 'light-wide'}-restored.png`) });
    });
  }
}
