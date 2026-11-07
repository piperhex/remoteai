import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = new URL('../../../.codex-tmp/browser-image-history/', import.meta.url);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9338');
try {
  const page = browser.contexts()[0].pages().find(page => page.url().includes('file-preview-harness'));
  if (!page) throw new Error('Native preview verification window not found');
  page.setDefaultTimeout(15_000);
  const preview = page.locator('.website-preview-browser');
  const expand = page.getByRole('button', { name: '展开详情抽屉', exact: true });
  if (await expand.count()) await expand.click();
  const address = preview.getByRole('textbox', { name: '页面地址', exact: true });
  const original = await address.inputValue();
  expect(original).toContain('image-preview-annotation-evidence/index.html');
  const frame = preview.frameLocator('iframe');
  const heading = frame.getByRole('heading', { name: '图片预览标注验证截图', exact: true });
  await expect(heading).toBeVisible();
  const image = frame.locator('a img').first();
  await image.click();
  await expect(address).toHaveValue(/local-wide-light-annotating\.png$/);
  await expect(preview.getByRole('tab')).toHaveCount(1);
  await expect.poll(() => preview.locator('.website-file-content:not([hidden]) img')
    .evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: fileURLToPath(new URL('windows-native-local-image.png', output)) });
  await preview.getByRole('button', { name: '后退', exact: true }).click();
  await expect(address).toHaveValue(original);
  await expect(heading).toBeVisible();
  await page.screenshot({ path: fileURLToPath(new URL('windows-native-local-returned.png', output)) });
  await preview.getByRole('button', { name: '前进', exact: true }).click();
  await expect(address).toHaveValue(/local-wide-light-annotating\.png$/);
  await preview.getByRole('button', { name: '后退', exact: true }).click();
  await expect(address).toHaveValue(original);
  await writeFile(new URL('windows-native-result.json', output), JSON.stringify({
    original, image: 'local-wide-light-annotating.png', tabs: await preview.getByRole('tab').count(),
    backAndForward: true, preservedBrowserPreview: true,
  }, null, 2));
  console.log('Windows WebView verified with the recorded HTML: image address, back/forward and one browser tab.');
} finally {
  await browser.close();
}
