import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const output = new URL('../../../.codex-tmp/website-tabs-native/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const context = browser.contexts()[0];
const page = context.pages().find(page => page.url().includes('website-tabs-harness'));
if (!page) throw new Error('Conversation browser verification window not found');
page.setDefaultTimeout(15_000);
const request = value => page.evaluate(request => window.__TAURI_INTERNALS__.invoke('codex_gui_browser', { request }), value);
const command = (tabId, command, threadId = 'preview-thread') => request({ threadId, tabId, command });
try {
  for (const tab of (await request({ threadId: 'preview-thread', command: { action: 'list' } })).tabs) {
    await command(tab.id, { action: 'close' });
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: '使用指南' }).click();
  await expect.poll(() => context.pages().some(page => page.url().includes('/preview-site/guide'))).toBe(true);
  const guide = context.pages().find(page => page.url().includes('/preview-site/guide'));
  await guide.getByRole('textbox', { name: '备注' }).fill('本地标签保留');
  await page.getByRole('link', { name: '项目概览' }).click();
  await page.getByRole('link', { name: '帮助中心' }).click();
  await expect(page.locator('.pm-browser-tabs [role="tab"]')).toHaveCount(3);
  await page.locator('.pm-browser-tabs [role="tab"]').first().click();
  await expect(guide.getByRole('textbox', { name: '备注' })).toHaveValue('本地标签保留');
  console.log('Native local tabs preserve independent page state');

  const opened = await request({ threadId: 'preview-thread', command: { action: 'open',
    requestId: 'native-automation-check', url: 'http://127.0.0.1:1553/preview-site/ai' } });
  const id = opened.tab.id;
  await expect(page.locator('.pm-browser-tabs [role="tab"]')).toHaveCount(4);
  let snapshot;
  await expect.poll(async () => {
    snapshot = (await command(id, { action: 'snapshot' })).result;
    return snapshot?.elements?.some(element => element.name === '备注');
  }).toBe(true);
  const reference = name => snapshot.elements.find(element => element.name === name).reference;
  await command(id, { action: 'type', reference: reference('备注'), text: '模型已填写预览内容' });
  await command(id, { action: 'select', reference: reference('类型'), value: 'b' });
  await command(id, { action: 'click', reference: reference('确认') });
  const ai = context.pages().find(page => page.url().includes('/preview-site/ai'));
  await expect(ai.getByRole('textbox', { name: '备注' })).toHaveValue('模型已填写预览内容');
  await expect(ai.getByRole('button', { name: '完成' })).toBeVisible();
  await expect(ai.locator('[data-remote-ai-pointer="embedded-preview"]')).toHaveCount(1);
  snapshot = (await command(id, { action: 'snapshot' })).result;
  expect(snapshot.elements.find(element => element.name === '备注').value).toBe('模型已填写预览内容');
  await command(id, { action: 'type', reference: reference('备注'), text: 'ABC' });
  await command(id, { action: 'key', key: 'End' });
  await command(id, { action: 'key', key: 'Backspace' });
  await expect(ai.getByRole('textbox', { name: '备注' })).toHaveValue('AB');
  await command(id, { action: 'key', key: 'Enter' });
  await expect(ai.locator('#result')).toHaveText('已提交');
  await command(id, { action: 'key', key: 'Tab' });
  await expect(ai.getByRole('combobox', { name: '类型' })).toBeFocused();
  await command(id, { action: 'type', reference: reference('备注'), text: '模型已填写预览内容' });
  const capture = await command(id, { action: 'screenshot' });
  await writeFile(new URL('windows-local-ai-pointer.jpg', output), Buffer.from(capture.result.image.data, 'base64'));
  console.log('Native snapshots, typing, selection, click, pointer and screenshot verified');

  const repeated = await request({ threadId: 'preview-thread', command: { action: 'open',
    requestId: 'native-automation-check', url: 'http://127.0.0.1:1553/preview-site/ai' } });
  expect(repeated.tab.id).toBe(id);
  expect((await request({ threadId: 'other-thread', command: { action: 'list' } })).tabs).toEqual([]);
  await expect(command(id, { action: 'snapshot' }, 'other-thread')).rejects.toThrow('market.browserTabUnavailable');
  await expect(command(id, { action: 'navigate', url: 'file:///C:/Windows/win.ini' })).rejects.toThrow('market.browserInvalidUrl');
  await expect(command(id, { action: 'navigate', url: 'http://127.0.0.1:1552/' })).rejects.toThrow('market.browserInvalidUrl');
  const stale = reference('备注');
  await command(id, { action: 'snapshot' });
  await expect(command(id, { action: 'type', reference: stale, text: 'stale' })).rejects.toThrow('market.browserStaleReference');
  await page.getByRole('tab', { name: '文件更改', exact: true }).click();
  const hiddenCapture = await command(id, { action: 'screenshot' });
  expect(hiddenCapture.result.image.data.length).toBeGreaterThan(1000);
  await writeFile(new URL('windows-hidden-ai-session.jpg', output), Buffer.from(hiddenCapture.result.image.data, 'base64'));
  await page.getByRole('tab', { name: '预览', exact: true }).click();
  snapshot = (await command(id, { action: 'snapshot' })).result;
  await command(id, { action: 'click', reference: reference('下一页') });
  await expect(ai).toHaveURL(/\/next$/);
  await command(id, { action: 'back' }); await expect(ai).toHaveURL(/\/ai$/);
  await command(id, { action: 'forward' }); await expect(ai).toHaveURL(/\/next$/);
  await command(id, { action: 'reload' });
  await expect(ai.getByRole('heading', { name: 'next', exact: true })).toBeVisible();
  snapshot = (await command(id, { action: 'snapshot' })).result;
  await command(id, { action: 'click', reference: reference('新窗口') });
  await expect.poll(async () => (await request({ threadId: 'preview-thread', command: { action: 'list' } }))
    .tabs.some(tab => tab.url.endsWith('/popup'))).toBe(true);
  const popup = (await request({ threadId: 'preview-thread', command: { action: 'list' } }))
    .tabs.find(tab => tab.url.endsWith('/popup'));
  await command(popup.id, { action: 'close' });
  await expect(page.locator('.pm-browser-tabs [role="tab"]')).toHaveCount(4);
  await command(id, { action: 'navigate', url: 'http://127.0.0.1:1553/preview-site/ai' });
  await expect(ai).toHaveURL(/\/ai$/);
  snapshot = (await command(id, { action: 'snapshot' })).result;
  await command(id, { action: 'type', reference: reference('备注'), text: '内置浏览器操作已验证' });
  const more = page.locator('.website-preview-browser').getByRole('button', { name: '更多标签页', exact: true });
  await expect(more).toBeVisible(); await more.click();
  const menu = page.getByRole('menu', { name: '隐藏的标签页', exact: true });
  await expect(menu).toBeVisible();
  await page.screenshot({ path: new URL('windows-local-overflow-menu.png', output).pathname.replace(/^\/(\w:)/, '$1'),
    animations: 'disabled' });
  await page.keyboard.press('Escape'); await expect(menu).toBeHidden();
  await expect.poll(async () => (await command(id, { action: 'screenshot' })).result.image.data.length)
    .toBeGreaterThan(1000);
  console.log('Native keyboard editing, submission, focus, navigation, history and popup tabs verified');
  await page.screenshot({ path: new URL('windows-local-browser-chrome.png', output).pathname.replace(/^\/(\w:)/, '$1') });
  console.log('Thread isolation, URL restrictions, stale references, retry deduplication and hidden-session capture verified');
  await writeFile(new URL('tab.json', output), JSON.stringify({ id }));
} finally {
  await browser.close();
}
