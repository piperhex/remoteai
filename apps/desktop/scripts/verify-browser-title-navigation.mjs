import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

// Run against provider_browser::data_smoke::opens_browser_data with Vite on port 1572.
const output = fileURLToPath(new URL('../../../.codex-tmp/browser-title-navigation/', import.meta.url));
const titles = { list: '视频列表', video: '示例视频标题', next: '下一个视频' };
const site = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  const title = path === '/video/BV-test' ? titles.video : path === '/next' ? titles.next : titles.list;
  const links = {
    '/list': '<a href="/video/BV-test?from=list" target="_blank">打开视频</a>',
    '/video/BV-test': '<a href="/next">下一个视频</a>',
    '/next': '<a href="/untitled">无标题页面</a>',
  };
  response.setHeader('content-type', 'text/html; charset=utf-8');
  const heading = path === '/untitled' ? '<h1>无标题页面</h1>' : `<title>${title}</title><h1>${title}</h1>`;
  response.end(`<!doctype html>${heading}${links[path] ?? ''}`);
});

async function verifyTitleDuringReplaceState(tab, video, address, updated) {
  const titleChanges = await tab.locator(':scope > span:not([aria-hidden])').evaluateHandle(label => {
    const observed = [];
    const observer = new MutationObserver(() => observed.push(label.textContent));
    observer.observe(label, { childList: true, characterData: true, subtree: true });
    return { observed, observer };
  });
  await video.evaluate(search => history.replaceState(null, '', search), new URL(updated).search);
  await expect(address).toHaveValue(updated);
  await expect(tab).toHaveAccessibleName(titles.video);
  const observed = await titleChanges.evaluate(({ observed, observer }) => {
    observer.disconnect();
    return observed;
  });
  await titleChanges.dispose();
  assert.deepEqual(observed, [], 'Changing only the URL should not briefly replace the title');
}

async function verify(host, mode, origin) {
  const settings = mode === 'remote' ? '&font=20&dark' : '';
  await host.goto(`http://127.0.0.1:1572/e2e/browser-data-harness.html?mode=${mode}${settings}`);
  const address = host.getByLabel('页面地址', { exact: true });
  await address.fill(`${origin}/list`);
  await address.press('Enter');
  const tabs = host.getByRole('tab');
  await expect(tabs.first()).toHaveAccessibleName(titles.list);

  const engine = await chromium.connectOverCDP('http://127.0.0.1:9356');
  try {
    const context = engine.contexts()[0];
    const list = context.pages().find(page => page.url() === `${origin}/list`);
    await list.getByRole('link', { name: '打开视频' }).click();
    const tab = tabs.nth(1);
    await expect(tab).toHaveAccessibleName(titles.video);
    const video = context.pages().find(page => page.url() === `${origin}/video/BV-test?from=list`);
    const updated = `${origin}/video/BV-test?from=list&detail=1`;
    await verifyTitleDuringReplaceState(tab, video, address, updated);
    await expect(tabs.first()).toHaveAccessibleName(titles.list);
    const toolbar = await host.locator('.pm-browser-toolbar').boundingBox();
    assert(toolbar, 'The address toolbar must be visible');
    const clip = { x: 0, y: 0,
      width: Math.floor(toolbar.x + toolbar.width), height: Math.ceil(toolbar.y + toolbar.height) };
    await host.screenshot({ clip, path: `${output}desktop-${mode}-video-title.png` });

    await video.evaluate(() => {
      history.pushState(null, '', '#details');
      document.title = '视频详情';
    });
    await expect(address).toHaveValue(`${updated}#details`);
    await expect(tab).toHaveAccessibleName('视频详情');
    await video.evaluate(() => history.back());
    await expect(address).toHaveValue(updated);
    await expect(tab).toHaveAccessibleName('视频详情');

    await video.getByRole('link', { name: titles.next }).click();
    await expect(address).toHaveValue(`${origin}/next`);
    await expect(tab).toHaveAccessibleName(titles.next);
    await video.reload();
    await expect(tab).toHaveAccessibleName(titles.next);
    await video.getByRole('link', { name: '无标题页面' }).click();
    await expect(tab).toHaveAccessibleName('untitled · 127.0.0.1');
    await video.evaluate(() => history.replaceState(null, '', '?detail=1'));
    await expect(address).toHaveValue(`${origin}/untitled?detail=1`);
    await expect(tab).toHaveAccessibleName('untitled · 127.0.0.1');
  } finally {
    await engine.close();
  }
}

await mkdir(output, { recursive: true });
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
let browser;
try {
  const address = site.address();
  assert(address && typeof address === 'object');
  browser = await chromium.connectOverCDP('http://127.0.0.1:9355');
  const host = browser.contexts()[0].pages().find(page => page.url().includes('browser-data-harness'));
  assert(host, 'The isolated browser data harness must be running');
  const origin = `http://127.0.0.1:${address.port}`;
  for (const mode of ['local', 'remote']) await verify(host, mode, origin);
  console.log('Desktop local and remote kept the video title through same-document address changes.');
} finally {
  await browser?.close();
  site.closeAllConnections();
  site.close();
}
