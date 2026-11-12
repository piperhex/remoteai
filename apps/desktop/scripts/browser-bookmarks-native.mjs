import { chromium, expect } from '@playwright/test';

const mode = process.argv[2] ?? 'local';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
try {
  const context = browser.contexts()[0];
  const page = context.pages().find(entry => entry.url().startsWith('http://127.0.0.1:1552/'));
  if (!page) throw new Error('Native bookmark fixture is not running');
  page.setDefaultTimeout(20_000);
  const sidebar = mode === 'remote';
  await page.goto(`http://127.0.0.1:1552/e2e/browser-bookmarks-harness.html?mode=${mode}${sidebar ? '&sidebar=1&dark=1&font=20' : ''}`,
    { waitUntil: 'domcontentloaded' });
  const chrome = page.locator('.pm-browser');
  const address = chrome.getByRole('textbox', { name: '页面地址', exact: true });
  await address.fill('http://127.0.0.1:1553/preview-site/guide'); await address.press('Enter');
  await expect.poll(() => context.pages().some(entry => entry.url().includes(':1553/preview-site/guide'))).toBe(true);
  await chrome.locator('.browser-bookmark-star').click();
  const editor = page.getByRole('dialog', { name: '编辑书签', exact: true });
  await editor.getByRole('textbox', { name: '名称' }).fill('使用指南');
  await editor.getByRole('button', { name: /保\s*存/ }).click();
  await expect(editor).toBeHidden();
  await expect(chrome.locator('.browser-bookmark-item').filter({ hasText: '使用指南' })).toBeVisible();
  await address.fill('http://127.0.0.1:1553/preview-site/second'); await address.press('Enter');
  await chrome.locator('.browser-bookmark-star').click();
  await editor.getByRole('textbox', { name: '名称' }).fill('排序测试');
  await editor.getByRole('button', { name: /保\s*存/ }).click();
  await expect(editor).toBeHidden();
  const guide = chrome.locator('.browser-bookmark-item').filter({ hasText: '使用指南' });
  const temporary = chrome.locator('.browser-bookmark-item').filter({ hasText: '排序测试' });
  const source = await guide.boundingBox(), target = await temporary.boundingBox();
  if (!source || !target) throw new Error('Native bookmark drag targets are missing');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width - 3, target.y + target.height / 2, { steps: 8 });
  await expect(temporary).toHaveClass(/bookmark-drop-after/);
  await page.mouse.up();
  await expect(chrome.locator('.browser-bookmark-item')).toHaveText(['排序测试', '使用指南']);
  await temporary.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '编辑书签' }).click();
  await editor.getByRole('textbox', { name: '名称' }).fill('修改测试');
  await editor.getByRole('button', { name: /保\s*存/ }).click();
  await expect(editor).toBeHidden();
  await chrome.locator('.browser-bookmark-item').filter({ hasText: '修改测试' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await page.getByRole('dialog', { name: '删除', exact: true }).getByRole('button', { name: /删\s*除/ }).click();
  await expect(chrome.locator('.browser-bookmark-item')).toHaveText(['使用指南']);
  await chrome.getByRole('button', { name: '浏览器设置', exact: true }).click();
  await expect(page.getByRole('switch', { name: '显示书签栏' })).toBeVisible();
  await page.getByRole('switch', { name: '显示书签栏' }).click();
  await expect(chrome.getByRole('navigation', { name: '书签栏' })).toHaveCount(0);
  await page.getByRole('switch', { name: '显示书签栏' }).click();
  await expect(chrome.getByRole('navigation', { name: '书签栏' })).toBeVisible();
  if (process.argv.includes('--bar') || process.argv.includes('--menu')) {
    await chrome.getByRole('button', { name: '浏览器设置', exact: true }).click();
    await expect(page.getByRole('switch', { name: '显示书签栏' })).toBeHidden();
  }
  if (process.argv.includes('--menu')) await guide.click({ button: 'right' });
  console.log(`Native ${mode}: real child WebView, right-click edit/delete, drag sort and settings passed.`);
} finally { await browser.close(); }
