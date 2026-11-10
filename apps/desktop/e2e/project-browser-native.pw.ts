import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, expect } from '@playwright/test';
import type { BrowserHostMessage } from '../../../shared/project-browser/nativeBridge';
import type { DocumentsSnapshot } from '../../../shared/project-browser/documents';
import type { ProjectFile } from '../../../shared/remote-chat/projectFiles';
import type { FileSelection } from '../../../shared/project-browser/fileSelection';
import type { ProjectBrowserClient } from '../../../shared/project-browser/protocol';
import { browserRequest, browserRoot, savedFiles } from './project-browser-fixture';
import { longPress } from './project-browser-touch';
const require = createRequire(import.meta.url);
const { handleBrowserRequest } = require('../../../shared/project-browser/nativeBridge') as
  typeof import('../../../shared/project-browser/nativeBridge');
const { createProjectBrowserClient } = require('../../../shared/project-browser/protocol') as
  typeof import('../../../shared/project-browser/protocol');
const { DEFAULT_CHAT_POLICY, setChatPolicy, setChatConnectionMode } = require('../../../shared/remote-chat/policy') as
  typeof import('../../../shared/remote-chat/policy');

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (message: string) => void };
    projectBrowserMessage: (message: BrowserHostMessage) => void;
    nativeBrowserRequest: (message: string) => Promise<void>;
  }
}

test('bundled native editor: offline assets, mobile search/fold/save and close guard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const html = readFileSync(new URL('../../native/assets/project-browser.html', import.meta.url), 'utf8');
  const client = createProjectBrowserClient(browserRequest);
  const emit = (message: BrowserHostMessage) => page.evaluate(value => window.projectBrowserMessage(value), message);
  let closed = false;
  let fullscreen = false;
  let snapshot: DocumentsSnapshot | undefined;
  const references: ProjectFile[] = [];
  const quotes: FileSelection[] = [];
  await page.exposeFunction('nativeBrowserRequest', async (raw: string) => {
    const message = JSON.parse(raw) as { type: string; snapshot?: DocumentsSnapshot; active?: boolean };
    if (message.type === 'ready') {
      await emit({ type: 'settings', cwd: browserRoot, connected: true, labels: {}, autoSaveDelay: 0, snapshot,
        theme: { '--ink': '#e6e8eb', '--panel': '#1b201e', '--muted': '#a2aaa7',
          '--bg': '#121614', '--line': '#35413a', '--green': '#61d6ad', '--browser-on-accent': '#121614' } });
    } else if (message.type === 'closed') { closed = true; snapshot = message.snapshot; }
    else if (message.type === 'fullscreen') fullscreen = !!message.active;
    else {
      const reply = await handleBrowserRequest(raw, { client, cwd: browserRoot, connected: true,
        host: { copyPath: async () => {}, reference: async entry => { references.push(entry); },
          quoteSelection: async selection => { quotes.push(selection); } } });
      if (reply) await emit(reply);
    }
  });
  await page.addInitScript(() => {
    window.ReactNativeWebView = { postMessage: message => { void window.nativeBrowserRequest(message); } };
  });
  await page.route('**/native-browser.html', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('/native-browser.html');
  const search = page.getByRole('searchbox', { name: '搜索文件或文件夹' });
  await search.fill('MAIN.TS');
  await expect(page.getByRole('treeitem', { name: 'main.ts', exact: true })).toContainText('src/main.ts');
  await page.getByRole('button', { name: '清空搜索' }).click();
  const folder = page.getByRole('treeitem', { name: 'src', exact: true });
  await longPress(page, folder);
  await expect(page.getByRole('menuitem', { name: '下载为 ZIP', exact: true })).toBeVisible();
  await expect(folder).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('menuitem', { name: '新建', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建文件夹', exact: true }).click();
  await page.getByRole('textbox', { name: '名称', exact: true }).fill('native-folder');
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: 'native-folder', exact: true })).toBeVisible();
  // The create action expands its destination, so collapse it before the original navigation check.
  await folder.click();
  await page.getByRole('treeitem', { name: 'src', exact: true }).click();
  await page.getByRole('treeitem', { name: 'main.ts', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '文件内容', exact: true });
  const originalEditor = await editor.elementHandle();
  await page.getByRole('button', { name: '全屏浏览', exact: true }).click();
  await expect.poll(() => fullscreen).toBe(true);
  for (const [language, label] of [['en', 'Exit fullscreen'], ['ru', 'Выйти из полноэкранного режима'],
    ['ja', '全画面表示を終了'], ['zh', '退出全屏']] as const) {
    await emit({ type: 'settings', cwd: browserRoot, connected: true, labels: {}, autoSaveDelay: 0, theme: {}, language });
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    expect(await originalEditor!.evaluate(element => element.isConnected)).toBe(true);
  }
  await emit({ type: 'close' });
  await expect.poll(() => fullscreen).toBe(false);
  expect(closed).toBe(false);
  expect(await originalEditor!.evaluate(element => element.isConnected)).toBe(true);
  await page.getByRole('button', { name: '全屏浏览', exact: true }).click();
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  await expect.poll(() => fullscreen).toBe(false);
  await expect(editor).toContainText('function');
  await page.getByRole('button', { name: '全部折叠', exact: true }).click();
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(1);
  await page.getByRole('button', { name: '全部展开', exact: true }).click();
  await page.getByRole('button', { name: '查找', exact: true }).click();
  await page.getByPlaceholder('查找', { exact: true }).fill('message');
  await expect(page.locator('.cm-searchMatch')).not.toHaveCount(0);
  await page.keyboard.press('Escape');
  await editor.fill('export const 手机编辑 = true;\n');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  expect(savedFiles.at(-1)?.text).toBe('export const 手机编辑 = true;\n');
  await editor.fill('keep my unsaved draft');
  await page.getByRole('button', { name: '关闭文件 main.ts', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  expect(closed).toBe(false);
  await page.screenshot({ path: '../../.codex-tmp/project-browser-native-dark.png' });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await emit({ type: 'close' });
  await expect.poll(() => closed).toBe(true);
  await page.reload();
  await expect(editor).toContainText('keep my unsaved draft');
  await expect(page.getByRole('tab', { name: 'main.ts' }).locator('.pf-dirty-dot')).toBeVisible();
  await editor.press('Control+s');
  await expect(page.getByRole('tab', { name: 'main.ts' }).locator('.pf-dirty-dot')).toHaveCount(0);
  expect(errors).toEqual([]);
  await longPress(page, page.getByRole('tab', { name: 'main.ts', exact: true }), '标签页操作');
  await page.getByRole('menuitem', { name: '向下拆分', exact: true }).click();
  await expect(page.locator('.pf-editor-pane')).toHaveCount(2);
  const secondEditor = page.locator('.pf-editor-pane').nth(1)
    .getByRole('textbox', { name: '文件内容', exact: true });
  await secondEditor.fill('shared native draft');
  closed = false;
  await emit({ type: 'close' });
  await expect.poll(() => closed).toBe(true);
  await page.reload();
  await expect(page.locator('.pf-editor-pane')).toHaveCount(2);
  for (const pane of await page.locator('.pf-editor-pane').all()) {
    await expect(pane.getByRole('textbox', { name: '文件内容', exact: true })).toContainText('shared native draft');
  }
  await page.screenshot({ path: '../../.codex-tmp/project-browser-native-split.png', animations: 'disabled' });
  for (const name of ['notes.txt', 'src']) {
    closed = false;
    await page.getByRole('button', { name: '返回文件列表', exact: true }).first().click();
    await longPress(page, page.getByRole('treeitem', { name, exact: true }));
    await page.screenshot({ path: `../../.codex-tmp/project-reference-native-${name}-menu.png` });
    await page.getByRole('menuitem', { name: '引用文件', exact: true }).click();
    await expect.poll(() => closed).toBe(true);
    expect(snapshot?.tabs.find(tab => tab.path.endsWith('/main.ts'))?.text).toBe('shared native draft');
    await page.reload();
    await expect(page.locator('.pf-editor-pane')).toHaveCount(2);
  }
  expect(references).toEqual([
    { path: `${browserRoot}/notes.txt`, name: 'notes.txt', directory: false },
    { path: `${browserRoot}/src`, name: 'src', directory: true },
  ]);
  closed = false;
  const quoteEditor = page.getByRole('textbox', { name: '文件内容', exact: true }).first();
  await quoteEditor.press('Control+a');
  await longPress(page, quoteEditor.locator('.cm-line').first(), '文本操作');
  await page.getByRole('menuitem', { name: '引用到聊天' }).click();
  await expect.poll(() => closed).toBe(true);
  expect(quotes).toEqual([{ path: `${browserRoot}/src/main.ts`, start: { line: 1, column: 1 },
    end: { line: 1, column: 20 }, text: 'shared native draft' }]);
  expect(snapshot?.tabs.find(tab => tab.path.endsWith('/main.ts'))?.text).toBe('shared native draft');
  expect(errors).toEqual([]);
});

test('bundled native PDF: original paper opens with its outline and live Admin limits', async ({ page }, info) => {
  test.skip(!process.env.PDF_PREVIEW_FIXTURE, 'Set PDF_PREVIEW_FIXTURE to verify a local PDF.');
  const bytes = readFileSync(process.env.PDF_PREVIEW_FIXTURE!);
  const name = 'attachment-2610.39813v2.pdf';
  const path = `${browserRoot}/${name}`;
  const id = '11111111-1111-4111-8111-111111111111';
  let handles = 0;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const client: ProjectBrowserClient = {
    list: async () => ({ directory: browserRoot, parent: null, entries: [{ name, path, directory: false }], truncated: false }),
    read: async () => ({ path, kind: 'binary', size: bytes.length, revision: 'fixture', readOnly: true }),
    save: async () => { throw Error('Read-only fixture'); }, mutate: async () => { throw Error('Read-only fixture'); },
    transfer: {
      open: async () => { handles++; return { id, name, size: bytes.length, mimeType: 'application/pdf' }; },
      read: async ({ offset, length }) => ({ offset, data: bytes.subarray(offset, offset + length).toString('base64') }),
      close: async () => { handles--; }, browse: async () => { throw Error('Unused'); },
    },
  };
  const settings = (limit: number): BrowserHostMessage => ({ type: 'settings', cwd: browserRoot, connected: true,
    labels: {}, theme: {}, language: 'zh', pdfPreview: { mode: 'relay', policy: {
      ...DEFAULT_CHAT_POLICY, filePreviewMaxMb: limit, fileDownloadMaxMb: 1,
    } } });
  const emit = (message: BrowserHostMessage) => page.evaluate(value => window.projectBrowserMessage(value), message);
  const limit = async (value: number) => {
    setChatPolicy({ ...DEFAULT_CHAT_POLICY, filePreviewMaxMb: value, fileDownloadMaxMb: 1 });
    await emit(settings(value));
  };
  setChatConnectionMode('relay');
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, filePreviewMaxMb: 1 });
  await page.exposeFunction('nativeBrowserRequest', async (raw: string) => {
    if (JSON.parse(raw).type === 'ready') { await emit(settings(1)); return; }
    const reply = await handleBrowserRequest(raw, { client, cwd: browserRoot, connected: true });
    if (reply) await emit(reply);
  });
  await page.addInitScript(() => {
    window.ReactNativeWebView = { postMessage: message => { void window.nativeBrowserRequest(message); } };
  });
  const html = readFileSync(new URL('../../native/assets/project-browser.html', import.meta.url), 'utf8');
  await page.route('**/native-pdf.html', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.setViewportSize({ width: 390, height: 780 });
  try {
    await page.goto('/native-pdf.html');
    await page.getByRole('treeitem', { name, exact: true }).click();
    await expect(page.locator('.pf-file-panel:not([hidden])')).toContainText('暂时无法预览');
    expect(handles).toBe(0);
    await limit(100);
    const pdf = page.locator('.file-pdf-preview');
    await expect(pdf.locator('.file-pdf-page')).toHaveCount(28);
    await expect(pdf.locator('.file-pdf-page[data-pdf-page="1"] canvas')).toBeVisible();
    await page.screenshot({ path: info.outputPath('native-browser-original-first-page.png') });
    await pdf.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(pdf.locator('.file-pdf-pages')).toHaveAttribute('data-current-page', '2');
    await pdf.getByRole('button', { name: 'PDF 导航', exact: true }).click();
    await expect(pdf.locator('.file-pdf-thumbnail')).toHaveCount(28);
    await expect(pdf.locator('.file-pdf-thumbnail[data-thumbnail-page="2"] canvas')).toBeVisible();
    await pdf.getByRole('button', { name: '目录大纲', exact: true }).click();
    await expect(pdf.getByRole('button', { name: 'Additional Experiments', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('native-browser-original-outline.png') });
    await pdf.getByRole('button', { name: 'Additional Experiments', exact: true }).click();
    await expect.poll(() => pdf.locator('.file-pdf-pages').evaluate(element => {
      const target = element.querySelector('.file-pdf-page[data-pdf-page="15"]')!.getBoundingClientRect();
      const top = element.getBoundingClientRect().top;
      return target.top <= top + 16 && target.bottom > top + 16;
    })).toBe(true);
    await limit(1);
    await expect(pdf).toHaveCount(0);
    await expect(page.locator('.pf-file-panel:not([hidden])')).toContainText('暂时无法预览');
    expect(handles).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    setChatConnectionMode('offline'); setChatPolicy(DEFAULT_CHAT_POLICY);
  }
});
