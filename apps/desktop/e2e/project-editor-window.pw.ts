import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdtempSync, mkdirSync, openSync, writeSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { editorService } from '../../../scripts/project-editor-harness/client.mjs';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: bounded window edit, navigation and conflict preserve the complete file`, async ({ page }, info) => {
    const evidence = resolve('../../.codex-tmp/project-editor');
    mkdirSync(evidence, { recursive: true });
    const cwd = mkdtempSync(resolve(evidence, 'ui-'));
    const file = resolve(cwd, 'large.ts');
    const line = '// 中文🙂 log entry with CRLF\r\n';
    const block = Buffer.from(line.repeat(4096));
    const handle = openSync(file, 'w');
    for (let index = 0; index < 128; index += 1) writeSync(handle, block);
    closeSync(handle);
    const original = readFileSync(file);
    const service = editorService(resolve(evidence, 'after.exe'));
    const requests: object[] = [];
    await page.exposeBinding('projectEditorService', async (_, input: Record<string, unknown>) => {
      requests.push(input);
      const reply = await service.request({ ...input, cwd, path: 'large.ts' });
      return reply.data && { ...reply.data, path: input.path };
    });
    try {
      await page.addInitScript(() => {
        localStorage.setItem('codex-switch.project-browser.auto-save', '0');
        localStorage.setItem('codex-switch:language', 'zh');
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(`/e2e/project-browser-harness.html?mode=${mode}&largeText=1&editorService=1`,
        { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: '文件浏览', exact: true }).click();
      await page.getByRole('treeitem', { name: 'large.ts', exact: true }).click();
      const editor = page.getByRole('textbox', { name: '文件内容', exact: true });
      await expect(page.locator('.pf-window-navigation')).toBeVisible();
      await expect(editor).toContainText('中文🙂');
      expect(requests.filter(request => (request as { operation: string }).operation === 'projectFileRead')).toHaveLength(1);
      await page.screenshot({ path: info.outputPath(`${mode}-window-initial.png`) });
      const beforePaste = await editor.innerText();
      await editor.press('Control+Home');
      await page.keyboard.insertText('x'.repeat(256 * 1024 + 1));
      await expect(page.getByRole('alert')).toContainText('本页内容不能超过 256 KB');
      expect(await editor.innerText()).toBe(beforePaste);
      await editor.press('Control+Home');
      await page.keyboard.insertText('saved-prefix\n');
      await page.getByRole('button', { name: '下一页', exact: true }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${mode}-window-unsaved.png`) });
      await page.getByRole('alertdialog').getByRole('button', { name: '保存并继续', exact: true }).click();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      await expect(editor).not.toContainText('saved-prefix');
      const saved = readFileSync(file);
      expect(saved.length).toBe(original.length + Buffer.byteLength('saved-prefix\r\n'));
      expect(saved.subarray(Buffer.byteLength('saved-prefix\r\n')).equals(original)).toBe(true);
      await page.getByRole('button', { name: '第一页', exact: true }).click();
      await expect(editor).toContainText('saved-prefix');
      await editor.press('Control+Home');
      await page.keyboard.insertText('keep-my-draft');
      writeFileSync(file, 'external edit');
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('文件已在其他地方修改');
      await expect(editor).toContainText('keep-my-draft');
      expect(readFileSync(file, 'utf8')).toBe('external edit');
      await page.screenshot({ path: info.outputPath(`${mode}-window-conflict.png`) });
      await page.setViewportSize({ width: mode === 'web' ? 390 : 820, height: 900 });
      await page.screenshot({ path: info.outputPath(`${mode}-window-narrow.png`) });
    } finally { service.close(); }
  });
}

test('native offline asset: page editing and released languages use the host bridge at phone width', async ({ page }, info) => {
  const evidence = resolve('../../.codex-tmp/project-editor');
  const adapter = resolve(evidence, 'native-adapter.mjs');
  await build({ stdin: { resolveDir: resolve('../..'), contents:
    "export {handleBrowserRequest} from './shared/project-browser/nativeBridge';"
    + "export {createProjectBrowserClient} from './shared/project-browser/protocol';" },
    bundle: true, format: 'esm', platform: 'node', outfile: adapter });
  const { handleBrowserRequest, createProjectBrowserClient } = await import(pathToFileURL(adapter).href) as
    typeof import('../../../shared/project-browser/nativeBridge') & typeof import('../../../shared/project-browser/protocol');
  const cwd = mkdtempSync(resolve(evidence, 'native-ui-')).replaceAll('\\', '/');
  const path = `${cwd}/large.txt`;
  const source = '中文🙂 native log\r\n'.repeat(100_000);
  writeFileSync(path, source);
  const service = editorService(resolve(evidence, 'after.exe'));
  const client = createProjectBrowserClient(async input => {
    if (input.operation === 'projectFiles') return { directory: cwd, parent: null, truncated: false,
      entries: [{ name: 'large.txt', path, directory: false }] } as never;
    return (await service.request(input)).data;
  });
  const settings = { type: 'settings' as const, cwd, connected: true, labels: {}, autoSaveDelay: 0,
    theme: { '--ink': '#202c29', '--muted': '#73827c', '--panel': '#fff', '--bg': '#f5f8f6',
      '--line': '#dfe5e1', '--green': '#138475', '--browser-on-accent': '#fff' },
    language: 'zh' as const, themeMode: 'light' as const };
  await page.exposeBinding('nativeHost', async (_, raw: string) => {
    const message = JSON.parse(raw);
    if (message.type === 'ready') {
      await page.evaluate(settings => window.projectBrowserMessage(settings), settings);
    } else {
      const reply = await handleBrowserRequest(raw, { client, cwd, connected: true });
      if (reply) await page.evaluate(reply => window.projectBrowserMessage(reply), reply);
    }
  });
  await page.addInitScript(() => {
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    window.ReactNativeWebView = { postMessage: raw => {
      void (window as unknown as { nativeHost: (raw: string) => Promise<void> }).nativeHost(raw);
    } };
  });
  await page.route('**/native-editor', route => route.fulfill({ contentType: 'text/html',
    body: readFileSync(resolve('../native/assets/project-browser.html'), 'utf8') }));
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/native-editor');
    await page.getByRole('treeitem', { name: 'large.txt', exact: true }).click();
    const editor = page.getByRole('textbox', { name: '文件内容', exact: true });
    await expect(editor).toContainText('中文🙂');
    await editor.press('Control+Home');
    await page.keyboard.insertText('native-prefix\n');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.locator('.pf-status:visible')).toContainText('已保存');
    expect(readFileSync(path, 'utf8')).toBe(`native-prefix\r\n${source}`);
    for (const language of ['zh', 'en', 'ja', 'ru'] as const) {
      await page.evaluate(settings => window.projectBrowserMessage(settings), { ...settings, language });
      await expect(page.locator('.pf-window-navigation')).toContainText(/256|字节|Bytes|バイト|Байт/);
      await page.screenshot({ path: info.outputPath(`native-asset-phone-${language}-saved.png`) });
    }
  } finally { service.close(); }
});
