import { expect, test } from '@playwright/test';
import { previewSamples } from './preview-samples';
import { readFileSync } from 'node:fs';
import tauriConfig from '../src-tauri/tauri.conf.json' with { type: 'json' };

const documentUrl = 'file:///C:/project/page.html';
const imageName = '屏幕 截图.svg';
const imageUrl = `file:///C:/project/${encodeURIComponent(imageName)}`;
const navigation = readFileSync(
  new URL('../src-tauri/src/codex_gui/file_preview/navigation.js', import.meta.url), 'utf8');
const html = '<!doctype html><html><head><meta charset="utf-8"><style>'
  + 'body{font:14px/1.7 system-ui;padding:24px;color:#17382c;background:#f5f7f6}'
  + 'img{display:block;width:260px;max-width:100%;margin:16px 0;border-radius:12px}'
  + 'button{padding:8px 16px} .gap{height:360px}</style></head><body>'
  + '<h1>截图预览</h1><p>点击截图查看原图，使用后退回到此页面。</p>'
  + '<button onclick="this.textContent=\'已保留页面状态\'">保留页面状态</button><div class="gap"></div>'
  + `<a href="${encodeURIComponent(imageName)}" target="_blank"><img src="${encodeURIComponent(imageName)}"`
  + ' alt="第一张截图"></a><a href="second.svg" download><img src="second.svg" alt="第二张截图"></a>'
  + '<script>try{parent.document.body.dataset.escaped="yes"}catch{document.body.dataset.isolated="yes"}</script>'
  + '</body></html>';

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode} light opens a large HTML document and its source`, async ({ page }, info) => {
    const sample = [
      '<!doctype html>', '<meta charset="utf-8">', '<title>课程手册</title>',
      '<style>body{font:16px/1.8 system-ui;color:#243b36;margin:32px}img{width:200px}</style>',
      '<h1>训练课程手册</h1>', '<p>言语训练 · 看图描述</p>', '<img alt="课程配图" src="photo.svg">',
      '<!--', '课程记录 · lesson notes\n'.repeat(130_000), '-->', '<p>手册结束</p>',
    ].join('\n');
    await page.setViewportSize({ width: mode === 'remote' ? 1050 : 1440, height: 900 });
    await page.route('**/resource/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/photo.svg')) return route.fulfill({
        contentType: 'image/svg+xml', body: previewSamples()['image.svg'],
      });
      const source = url.searchParams.has('__preview_source');
      return route.fulfill({ contentType: source ? 'text/plain;charset=utf-8' : 'text/html;charset=utf-8',
        body: sample });
    });
    await page.goto(`e2e/reply-resources-harness.html?mode=${mode}&largeHtml&pdfLimit=1`);
    await page.locator('main').getByRole('button').filter({ hasText: 'page.html' }).click();
    const browser = page.locator('.website-preview-browser');
    const frame = browser.frameLocator('iframe');
    await expect(frame.getByText('手册结束')).toBeVisible();
    await expect.poll(() => frame.getByAltText('课程配图').evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath(`${mode}-large-html-preview.png`) });
    await browser.getByRole('button', { name: '源码', exact: true }).click();
    if (mode === 'web') await expect(browser.locator('pre code').first()).toContainText('<!doctype html>');
    else {
      await expect(frame.locator('body')).toContainText('<h1>训练课程手册</h1>');
      await expect(frame.locator('h1')).toHaveCount(0);
    }
    await page.screenshot({ path: info.outputPath(`${mode}-large-html-source.png`) });
    await browser.getByRole('button', { name: '预览', exact: true }).click();
    await expect(frame.getByRole('heading', { name: '训练课程手册' })).toBeVisible();
  });

  for (const narrow of [false, true]) {
    const label = `${mode} ${narrow ? 'dark narrow font20' : 'light wide'}`;
    test(`${label} image address and history`, async ({ page }, info) => {
      const capture = (state: string) => page.screenshot({
        path: info.outputPath(`${label.replaceAll(' ', '-')}-${state}.png`),
      });
      await page.setViewportSize({ width: narrow ? 1024 : 1440, height: 900 });
      if (narrow) await page.addInitScript(() => localStorage.setItem('codex-switch:global-font-size', '20'));
      await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
      await page.route('**/resource/**', route => {
        const url = new URL(route.request().url());
        const name = decodeURIComponent(url.pathname.split('/').at(-1)!);
        const channel = url.searchParams.get('__preview_navigation');
        const body = channel ? html + '<script>'
          + navigation.replace('__PREVIEW_NAVIGATION_CHANNEL__', JSON.stringify(channel)) + '</script>' : html;
        return route.fulfill(name === 'page.html' ? { contentType: 'text/html', body }
          : { contentType: 'image/svg+xml', body: previewSamples()['image.svg'] });
      });
      await page.goto(`e2e/reply-resources-harness.html?mode=${mode}${narrow ? '&dark=1' : ''}`);
      if (mode === 'local') await page.evaluate(policy => {
        const meta = document.createElement('meta'); meta.httpEquiv = 'Content-Security-Policy';
        meta.content = policy; document.head.append(meta);
      }, Object.entries(tauriConfig.app.security.csp).map(([key, value]) => `${key} ${value}`).join('; '));
      await page.locator('main').getByRole('button').filter({ hasText: 'page.html' }).click();
      const browser = page.locator('.website-preview-browser');
      const address = browser.getByLabel('页面地址', { exact: true });
      const frame = browser.frameLocator('iframe');
      await expect(address).toHaveValue(documentUrl);
      await expect(frame.locator('body')).toHaveAttribute('data-isolated', 'yes');
      await frame.getByRole('button', { name: '保留页面状态', exact: true }).click();
      const first = frame.getByRole('img', { name: '第一张截图', exact: true });
      await expect.poll(() => first.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(200);
      await first.scrollIntoViewIfNeeded();
      const scroll = await first.evaluate(() => window.scrollY);
      await first.click();
      await expect(address).toHaveValue(imageUrl);
      const image = browser.locator('.website-file-content:not([hidden])').getByRole('img', { name: imageName });
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(200);
      await expect(browser.getByRole('tab')).toHaveCount(1);
      await capture('image');
      await browser.getByRole('button', { name: '后退', exact: true }).click();
      await expect(address).toHaveValue(documentUrl);
      await expect(frame.getByRole('button', { name: '已保留页面状态', exact: true })).toBeVisible();
      expect(await first.evaluate(() => window.scrollY)).toBe(scroll);
      await capture('returned');
      for (let index = 0; index < 2; index++) {
        await browser.getByRole('button', { name: '前进', exact: true }).click();
        await expect(address).toHaveValue(imageUrl);
        await browser.getByRole('button', { name: '后退', exact: true }).click();
        await expect(address).toHaveValue(documentUrl);
      }
      await frame.getByRole('img', { name: '第二张截图', exact: true }).click();
      await expect(address).toHaveValue('file:///C:/project/second.svg');
      await browser.getByRole('button', { name: '前进', exact: true }).click();
      await expect(address).toHaveValue('file:///C:/project/second.svg');
      await browser.getByRole('button', { name: '后退', exact: true }).click();
      await expect(address).toHaveValue(documentUrl);
      await expect(browser.getByRole('tab')).toHaveCount(1);
      expect(await page.evaluate(() => document.body.dataset.escaped)).toBeUndefined();
      expect(page.context().pages()).toHaveLength(1);
    });
  }
}
