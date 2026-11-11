import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { localBackend, nativeShell } from './cli-gui-support';
import type { createCliGuiFixture } from './cli-gui-fixture';

const evidence = resolve('../../.codex-tmp/cli-images-evidence');
async function sample(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#f1f7f6'; context.fillRect(0, 0, 640, 360);
    context.fillStyle = '#28837f'; context.fillRect(60, 70, 180, 220);
    context.fillStyle = '#253f3c'; context.font = '32px sans-serif'; context.fillText('Image attachment', 270, 160);
    context.font = '20px sans-serif'; context.fillText('Preview / annotate / send', 270, 205);
    return canvas.toDataURL();
  });
}

for (const engine of ['claude', 'gemini']) test(`Windows adapter ${engine}: clipboard and native file drop`,
  async ({ page }) => {
    await localBackend(page); await nativeShell(page);
    let image = '';
    await page.route('**/__codex_switch__/api/invoke', async route => {
      const { command } = route.request().postDataJSON();
      const file = { name: 'native.png', mimeType: 'image/png', data: image.split(',')[1] };
      if (command === 'codex_gui_remote_clipboard_images') {
        await route.fulfill({ json: { ok: true, result: [file] } }); return;
      }
      if (command === 'codex_gui_dropped_files') {
        await route.fulfill({ json: { ok: true, result: { references: [], files: [file] } } }); return;
      }
      await route.fallback();
    });
    await page.goto('/e2e/cli-gui-harness.html?mode=local&native', { waitUntil: 'commit' });
    await page.locator(`[data-cli-thread="${engine}-history"] button`).click();
    image = await sample(page);
    await page.getByRole('textbox', { name: '消息', exact: true }).press('Control+v');
    const thumbnails = page.locator('.cli-gui-pane [aria-label="图片附件"] img');
    await expect(thumbnails).toHaveCount(1);
    const box = (await page.getByRole('textbox', { name: '消息', exact: true }).boundingBox())!;
    await page.evaluate(position => {
      (window as unknown as { emitNativeTestEvent: (name: string, value: unknown) => void })
        .emitNativeTestEvent('tauri://drag-drop', { paths: ['C:/test/native.png'],
          position: { x: position.x * devicePixelRatio, y: position.y * devicePixelRatio } });
    }, { x: box.x + 10, y: box.y + 10 });
    await expect(thumbnails).toHaveCount(2);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(thumbnails).toHaveCount(0);
    await expect(page.locator('.cli-gui-pane img').filter({ visible: true })).toHaveCount(2);
  });
async function pasteOrDrop(page: Page, image: string, type: 'paste' | 'drop') {
  await page.getByRole('textbox', { name: '消息', exact: true }).evaluate((element, args) => {
    const data = Uint8Array.from(atob(args.image.split(',')[1]), char => char.charCodeAt(0));
    const transfer = new DataTransfer(); transfer.items.add(new File([data], `${args.type}.png`, { type: 'image/png' }));
    element.dispatchEvent(args.type === 'paste'
      ? new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
      : new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, { image, type });
}

for (const mode of ['local', 'remote', 'web']) for (const engine of ['claude', 'gemini']) {
  for (const large of [false, true]) test(`${mode} ${engine}: images ${large ? 'large dark narrow' : 'default'}`,
    async ({ page }) => {
      page.setDefaultTimeout(15_000);
      await mkdir(evidence, { recursive: true });
      await page.setViewportSize(large ? { width: 960, height: 900 } : { width: 1440, height: 980 });
      const fixture = await localBackend(page);
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(`/e2e/cli-gui-harness.html?mode=${mode}${large ? '&large&dark' : ''}`,
        { waitUntil: 'commit' });
      const expand = page.getByRole('button', { name: '展开对话列表', exact: true });
      if (await expand.isVisible()) await expand.click();
      await page.locator(`[data-cli-thread="${engine}-history"] button`).click();
      await expect(page.locator('.cli-gui-pane button').filter({ hasText: 'GPT-6' })).toBeVisible();
      const image = await sample(page);
      const input = page.locator('.cli-gui-pane input[type=file]');
      const chooser = page.waitForEvent('filechooser');
      await page.locator('.cli-gui-pane').getByRole('button', { name: mode === 'local' ? '添加' : '添加内容', exact: true }).click();
      await page.getByRole('menuitem', { name: '选择图片', exact: true }).click();
      await (await chooser).setFiles({ name: 'sample.png', mimeType: 'image/png', buffer: Buffer.from(image.split(',')[1], 'base64') });
      const thumbnails = page.locator('.cli-gui-pane [aria-label="图片附件"] img');
      await expect(thumbnails).toHaveCount(1);
      await pasteOrDrop(page, image, 'paste'); await expect(thumbnails).toHaveCount(2);
      await pasteOrDrop(page, image, 'drop'); await expect(thumbnails).toHaveCount(3);
      await page.getByRole('button', { name: '移除图片 3', exact: true }).click();
      await expect(thumbnails).toHaveCount(2);
      const label = `${mode}-${engine}-${large ? 'large-dark-narrow' : 'default-light'}`;
      await page.getByRole('button', { name: '放大查看：图片 1', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'sample.png', exact: true })).toBeVisible();
      await page.screenshot({ path: resolve(evidence, `${label}-preview.png`) });
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '标注图片 1', exact: true }).click();
      const editor = page.frameLocator('iframe');
      await expect(editor.getByRole('button', { name: '完成', exact: true })).toBeEnabled();
      await editor.getByRole('button', { name: '圆形', exact: true }).click();
      const box = (await editor.locator('canvas').boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.2); await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.8, { steps: 8 }); await page.mouse.up();
      await editor.getByRole('button', { name: '完成', exact: true }).click();
      await expect(page.locator('iframe')).toHaveCount(0);
      await expect(thumbnails.first()).not.toHaveAttribute('src', image);
      await page.screenshot({ path: resolve(evidence, `${label}-draft.png`) });
      if (large) await page.getByRole('textbox', { name: '消息', exact: true }).fill('请查看图片中标注的位置。');
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
      await expect(thumbnails).toHaveCount(0);
      const calls = mode === 'local' ? fixture.calls : await page.evaluate(() =>
        (window as unknown as { cliFixture: ReturnType<typeof createCliGuiFixture> }).cliFixture.calls);
      const sent = calls.find(call => call.action === 'send');
      expect(sent).toMatchObject({ engine, text: large ? '请查看图片中标注的位置。' : '' });
      expect(sent?.action === 'send' && sent.images?.length).toBe(2);
      await expect(page.locator('.cli-gui-pane img').filter({ visible: true })).toHaveCount(2);
      await page.locator('.cli-gui-pane img').first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(evidence, `${label}-sent.png`) });
      await input.setInputFiles([]);
      expect(errors).toEqual([]);
    });
}
