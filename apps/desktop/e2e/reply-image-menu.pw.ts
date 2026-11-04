import { expect, test } from '@playwright/test';

test.setTimeout(90_000);

for (const mode of ['local', 'remote', 'web']) {
  for (const dark of [false, true]) {
    test(`${mode} ${dark ? 'dark narrow' : 'light wide'} image preview and alternate menu`, async ({ page }, info) => {
      await page.setViewportSize({ width: dark ? 1024 : 1440, height: 900 });
      await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
      const url = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 640; canvas.height = 360;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#dceee8'; context.fillRect(0, 0, 640, 360);
        context.fillStyle = '#16765c'; context.fillRect(40, 40, 560, 280);
        context.fillStyle = '#fff'; context.font = '32px sans-serif';
        context.fillText('Conversation image preview', 100, 190);
        return canvas.toDataURL('image/png');
      });
      await page.route('**/image-preview.json', route => route.fulfill({ json: { url } }));
      await page.route('**/resource/preview.png', route => route.fulfill({
        contentType: 'image/png', body: Buffer.from(url.split(',')[1], 'base64'),
      }));
      await page.route('https://resource.test/thumbnail.png', route => route.fulfill({
        contentType: 'image/png', body: Buffer.from(url.split(',')[1], 'base64'),
      }));
      for (const source of ['file', 'network']) {
        await page.goto(`/e2e/reply-resources-harness.html?mode=${mode}&image=1&source=${source}${dark ? '&dark=1' : ''}`);
        const thumbnail = page.locator('main').getByRole('button', { name: '放大查看：回复图片' });
        const viewer = page.locator('dialog.cs-image-viewer');
        const browser = page.locator('.website-preview-browser');
        await expect(thumbnail).toHaveAttribute('aria-busy', 'false');
        await thumbnail.click();
        await expect(viewer).toBeVisible();
        expect(await viewer.boundingBox()).toEqual({ x: 0, y: 0, ...page.viewportSize()! });
        await expect(browser).toHaveCount(0);
        await viewer.getByRole('button', { name: '放大图片', exact: true }).click();
        await expect(viewer.getByRole('button', { name: '还原图片', exact: true })).not.toHaveText('100%');
        await viewer.getByRole('button', { name: '还原图片', exact: true }).click();
        await page.screenshot({ animations: 'disabled',
          path: info.outputPath(`${mode}-${dark ? 'dark-narrow' : 'light-wide'}-${source}-fullscreen.png`) });
        await page.keyboard.press('Escape');
        await expect(viewer).toHaveCount(0);
        await thumbnail.click({ button: 'right' });
        const menu = page.getByRole('menu');
        const action = menu.getByRole('menuitem', { name: '在内置浏览器中打开', exact: true });
        await expect(action).toBeVisible();
        await expect(page.locator('.ant-dropdown:visible')).not.toHaveClass(/-(?:appear|enter)(?:-|\s|$)/);
        const mouseActions = await menu.getByRole('menuitem').allTextContents();
        await page.screenshot({ animations: 'disabled',
          path: info.outputPath(`${mode}-${dark ? 'dark-narrow' : 'light-wide'}-${source}-context-menu.png`) });
        await action.click();
        await expect(action).toBeHidden();
        await expect(browser.getByRole('img', { name: source === 'file' ? 'preview.png' : '回复图片',
          exact: true })).toBeVisible();
        await expect(viewer).toHaveCount(0);
        await thumbnail.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true,
          button: 0, clientX: 80, clientY: 180 });
        await expect(action).toBeVisible();
        await expect(page.locator('.ant-dropdown:visible')).not.toHaveClass(/-(?:appear|enter)(?:-|\s|$)/);
        await thumbnail.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch' });
        await thumbnail.dispatchEvent('click');
        await expect(viewer).toHaveCount(0);
        expect(await menu.getByRole('menuitem').allTextContents()).toEqual(mouseActions);
        await page.screenshot({ animations: 'disabled',
          path: info.outputPath(`${mode}-${dark ? 'dark-narrow' : 'light-wide'}-${source}-long-press.png`) });
        await action.click();
        await expect(browser.getByRole('tab')).toHaveCount(1);
        await thumbnail.click();
        await expect(viewer).toBeVisible();
        await viewer.getByRole('button', { name: '关闭图片', exact: true }).click();
        await expect(viewer).toHaveCount(0);
        expect(page.context().pages()).toHaveLength(1);
      }
    });
  }
}
