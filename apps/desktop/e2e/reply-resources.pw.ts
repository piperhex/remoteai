import { expect, test } from '@playwright/test';
import { previewSamples } from './preview-samples';

for (const mode of ['local', 'remote', 'web']) {
  for (const dark of [false, true]) {
    test(`${mode} ${dark ? 'dark narrow' : 'light wide'} reply resources use browser tabs`, async ({ page }, info) => {
      const samples: Record<string, Buffer> = previewSamples();
      samples['settings.json'] = Buffer.from('{"enabled":true,"name":"Resource preview"}');
      samples['archive.zip'] = Buffer.from('download fixture');
      samples['setup.exe'] = Buffer.from('installer fixture');
      await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
      await page.route('**/resource/**', route => {
        const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1)!);
        const mime = name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.mp4') ? 'video/mp4'
          : name.endsWith('.wav') ? 'audio/wav' : name.endsWith('.PDF') ? 'application/pdf'
            : name.endsWith('.css') ? 'text/css' : name.endsWith('.html') ? 'text/html' : 'text/plain';
        return route.fulfill({ contentType: mime, body: samples[name] ?? Buffer.from('fixture') });
      });
      if (dark) await page.setViewportSize({ width: 1024, height: 800 });
      await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
      await page.goto(`/e2e/reply-resources-harness.html?mode=${mode}${dark ? '&dark=1' : ''}`);
      const browser = page.locator('.website-preview-browser');
      const active = browser.locator('.pm-browser-page:not([hidden])');
      const open = async (name: string) => {
        await page.locator('main').getByRole('button').filter({ hasText: name }).click();
        await expect(browser.getByRole('tab', { selected: true })).toContainText(name);
      };
      await open('page.html');
      await expect(active.frameLocator('iframe').getByRole('heading', { name: 'HTML preview' })).toBeVisible();
      expect(await page.evaluate(() => document.body.dataset.escaped)).toBeUndefined();
      await open('image.svg');
      await expect.poll(() => active.getByRole('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(200);
      await active.getByRole('button', { name: '放大图片', exact: true }).click();
      await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark-narrow' : 'light-wide'}-image.png`) });
      await open('video.mp4');
      const video = active.locator('video');
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBeGreaterThan(0);
      await video.evaluate((element: HTMLVideoElement) => { element.muted = true; return element.play(); });
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
      await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark-narrow' : 'light-wide'}-video.png`) });
      await open('sound.wav');
      expect(await browser.locator('video').evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
      await expect.poll(() => active.locator('audio').evaluate((element: HTMLAudioElement) => element.duration)).toBe(1);
      await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark-narrow' : 'light-wide'}-audio.png`) });
      await open('report.PDF');
      await expect(active.locator('canvas')).toBeVisible();
      await active.getByRole('button', { name: '下一页', exact: true }).click();
      await expect(active.getByText('2 / 2', { exact: true })).toBeVisible();
      await expect(active.locator('canvas')).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark-narrow' : 'light-wide'}-pdf.png`) });
      await open('guide.md');
      await expect(active.getByRole('heading', { name: 'Preview heading' })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark-narrow' : 'light-wide'}-markdown.png`) });
      await open('settings.json');
      await expect(active).toContainText('Resource preview');
      samples['settings.json'] = Buffer.from('{"enabled":true,"name":"Updated resource"}');
      await browser.getByRole('textbox', { name: '页面地址', exact: true }).press('Enter');
      await expect(active).toContainText('Updated resource');
      await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark-narrow' : 'light-wide'}-json.png`) });
      await open('archive.zip');
      const card = active.locator('.resource-download-card');
      await expect(card).toContainText('archive.zip');
      await expect(card.getByRole('button', { name: '下载', exact: true })).toBeVisible();
      const cardBounds = (await card.boundingBox())!;
      const pageBounds = (await active.boundingBox())!;
      expect(Math.abs(cardBounds.x + cardBounds.width / 2 - pageBounds.x - pageBounds.width / 2)).toBeLessThan(2);
      await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark-narrow' : 'light-wide'}-archive.png`) });
      if (mode === 'web') {
        const download = page.waitForEvent('download');
        await card.getByRole('button', { name: '下载', exact: true }).click();
        expect((await download).suggestedFilename()).toBe('archive.zip');
      } else {
        await card.getByRole('button', { name: '下载', exact: true }).click();
        await expect(page.locator('body')).toHaveAttribute('data-action', /"type":"saveAs"/);
      }
      await open('setup.exe');
      await expect(active.locator('.resource-download-card')).toContainText('setup.exe');
      await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark-narrow' : 'light-wide'}-installer.png`) });
      await open('page.html');
      await expect(browser.getByRole('tab')).toHaveCount(9);
      await browser.getByRole('button', { name: '刷新', exact: true }).click();
      await expect(active.frameLocator('iframe').getByRole('heading', { name: 'HTML preview' })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${mode}-${dark ? 'dark-narrow' : 'light-wide'}-html.png`) });
      await browser.getByRole('button', { name: '关闭 page.html', exact: true }).click();
      await open('page.html');
      await expect(browser.getByRole('tab')).toHaveCount(9);
      await page.getByRole('button', { name: '切换会话', exact: true }).click();
      await expect(browser).toHaveCount(0);
      expect(page.context().pages()).toHaveLength(1);
    });
  }
}

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode} enlarged text keeps long download names centered and image clicks open fullscreen`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.addInitScript(() => localStorage.setItem('codex-switch:global-font-size', '20'));
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    await page.goto(`/e2e/reply-resources-harness.html?mode=${mode}&dark=1`);
    const file = page.locator('main').getByRole('button').filter({ hasText: '项目资源与动画素材归档' });
    if (mode !== 'web') {
      await file.click({ button: 'right' });
      await expect(page.getByRole('menuitem', { name: '另存为…', exact: true }).or(
        page.getByRole('menuitem', { name: '下载到本机…', exact: true }))).toBeVisible();
      await page.keyboard.press('Escape');
      await file.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true,
        button: 0, clientX: 80, clientY: 200 });
      await expect(page.getByRole('menu')).toBeVisible();
      await file.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch' });
      await page.keyboard.press('Escape');
    }
    await file.click();
    const card = page.locator('.resource-download-card');
    await expect(card).toBeVisible();
    expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${mode}-dark-narrow-font20-long-download.png`) });
    await page.route('https://resource.test/thumbnail.png', route => route.fulfill({
      contentType: 'image/svg+xml', body: previewSamples()['image.svg'],
    }));
    await page.goto(`/e2e/reply-resources-harness.html?mode=${mode}&image=1`);
    await page.locator('main').getByRole('button', { name: '放大查看：回复图片' }).click();
    const browser = page.locator('.website-preview-browser');
    const viewer = page.getByRole('dialog', { name: '回复图片', exact: true });
    await expect(viewer).toBeVisible();
    await expect(browser).toHaveCount(0);
    await expect(viewer.getByRole('img', { name: '回复图片' })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${mode}-light-narrow-font20-fullscreen-image.png`) });
    await viewer.getByRole('button', { name: '关闭图片', exact: true }).click();
    const thumbnail = page.locator('main').getByRole('button', { name: '放大查看：回复图片' });
    await thumbnail.click({ button: 'right' });
    const action = page.getByRole('menuitem', { name: '在内置浏览器中打开', exact: true });
    await expect(action).toBeVisible();
    await expect(page.locator('.ant-dropdown:visible')).not.toHaveClass(/-(?:appear|enter)(?:-|\s|$)/);
    await page.screenshot({ path: info.outputPath(`${mode}-light-narrow-font20-image-menu.png`) });
    await action.click();
    await expect(browser.getByRole('tab', { selected: true })).toContainText('回复图片');
    await expect(browser.getByRole('img', { name: '回复图片' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: '回复图片', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`${mode}-light-narrow-font20-reply-image.png`) });
  });
}
