import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// Consume the native smoke result so browser checks render the exact saved capture and reference.
const fixturePath = '../../.codex-tmp/browser-capture/capture.json';
const captured = existsSync(fixturePath) ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null;
const reference: { path: string; markdown: string } = captured?.structuredContent.result.screenshot
  ?? { path: '', markdown: '' };
const bytes = captured ? readFileSync(reference.path) : Buffer.alloc(0);
const url = `data:image/jpeg;base64,${bytes.toString('base64')}`;
test.skip(!captured, 'Run browser-capture-native.mjs to generate the native capture first.');

for (const entry of ['local', 'remote', 'web']) {
  for (const appearance of ['light', 'dark']) {
    test(`${entry} ${appearance}: saved screenshot appears once in reply and survives reload`, async ({ page }, info) => {
      await page.setViewportSize({ width: appearance === 'light' ? 1440 : 1024, height: 900 });
      const sources: string[] = [];
      await page.route('**/capture-fixture.json', route => route.fulfill({ json: reference }));
      await page.route('**/capture-image', route => {
        const request = route.request().postDataJSON();
        expect(request.threadId).toBe('capture-verification');
        sources.push(request.source);
        return route.fulfill({ json: { url } });
      });
      await page.route('**/__codex_switch__/api/invoke', route => {
        const { command, args } = route.request().postDataJSON();
        expect(command).toBe('codex_gui_request');
        expect(args.request.operation).toBe('imagePreview');
        expect(args.request.threadId).toBe('capture-verification');
        sources.push(args.request.source);
        return route.fulfill({ json: { ok: true, result: { data: { url } } } });
      });
      await page.goto(`/e2e/browser-capture-harness.html?entry=${entry}${appearance === 'dark' ? '&dark' : ''}`);
      const image = page.getByTestId('reply').getByRole('img', { name: '浏览器截图', exact: true });
      for (let pass = 0; pass < 2; pass++) {
        if (pass) await page.reload();
        await expect(image).toHaveCount(1);
        await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0))
          .toBe(true);
        await expect(page.getByRole('button', { name: '放大查看：浏览器截图', exact: true }))
          .toHaveAttribute('aria-busy', 'false');
        await expect(page.getByTestId('reply').getByRole('link')).toHaveCount(0);
      }
      expect(sources.length).toBeGreaterThanOrEqual(2);
      expect(sources.every(source => source === reference.path)).toBe(true);
      await page.screenshot({ path: info.outputPath(`windows-${entry}-${appearance}-reply.png`), animations: 'disabled' });
      await image.click();
      const viewer = page.getByRole('dialog', { name: '浏览器截图', exact: true });
      await expect(viewer).toBeVisible();
      await expect.poll(() => viewer.locator('img').evaluate((node: HTMLImageElement) =>
        node.complete && node.naturalWidth > 0)).toBe(true);
      await page.screenshot({ path: info.outputPath(`windows-${entry}-${appearance}-expanded.png`), animations: 'disabled' });
    });
  }
}
