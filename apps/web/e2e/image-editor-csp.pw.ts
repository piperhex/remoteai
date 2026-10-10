import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const { app: { security: { csp } } } = JSON.parse(
  readFileSync(new URL('../../desktop/src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
) as { app: { security: { csp: string } } };

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
});

async function desktopPolicy(page: Page) {
  await page.route('**/image-editor-harness.html', async route => {
    const response = await route.fetch();
    const body = await response.text();
    // Tauri permits the scripts in built HTML, but not dynamically generated inline scripts.
    const hashes = [...body.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
      .filter(match => match[1].trim())
      .map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
    await route.fulfill({ response, body,
      headers: { ...response.headers(), 'content-security-policy': `${csp}; script-src 'self' ${hashes.join(' ')}` } });
  });
}

test('edits and cancels local images under the packaged desktop policy', async ({ page }) => {
  await desktopPolicy(page);
  const violations: string[] = [];
  const imageRequests: string[] = [];
  page.on('request', request => {
    if (request.resourceType() === 'image' && !request.url().startsWith('data:')) imageRequests.push(request.url());
  });
  page.on('console', message => {
    if (/Executing inline script violates/.test(message.text())) violations.push(message.text());
  });
  await page.goto('e2e/image-editor-harness.html');
  const editor = page.frameLocator('iframe');
  await expect(editor.getByRole('button', { name: '完成', exact: true })).toBeEnabled();
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: '打开标注' }).click();
  await expect(editor.getByRole('button', { name: '完成', exact: true })).toBeEnabled();
  await editor.locator('canvas').click();
  await editor.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('img', { name: '保存的图片' })).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  expect(violations).toEqual([]);
  expect(imageRequests).toEqual([]);
});

test('can close while the editor is still loading', async ({ page }) => {
  await desktopPolicy(page);
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/image-editor.js', async route => { await waiting; await route.abort(); });
  try {
    await page.goto('e2e/image-editor-harness.html', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '关闭图片', exact: true }).click();
    await expect(page.locator('iframe')).toHaveCount(0);
    await page.getByRole('button', { name: '打开标注' }).click();
    await expect(page.locator('iframe')).toHaveCount(1);
    await page.getByRole('button', { name: '关闭图片', exact: true }).click();
    await expect(page.locator('iframe')).toHaveCount(0);
  } finally { release(); }
});

test('reports a failed editor and closes without discarding the original image', async ({ page }) => {
  await desktopPolicy(page);
  await page.route('**/image-editor.js', route => route.abort());
  await page.goto('e2e/image-editor-harness.html');
  const original = await page.getByRole('img', { name: '保存的图片' }).getAttribute('src');
  await expect(page.getByRole('alert')).toHaveText('图片无法编辑，请重新打开后再试。');
  await page.frameLocator('iframe').getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('img', { name: '保存的图片' })).toHaveAttribute('src', original!);
});
