import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const card = (page: Page, name = 'sample.bin') => page.getByRole('article', { name, exact: true });
const open = (page: Page) => page.goto('e2e/downloads-harness.html');
async function enqueue(page: Page, name = 'sample.bin') {
  await page.getByRole('button', { name: '当前项目', exact: true }).click();
  await page.getByRole('button', { name: `下载：${name}`, exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已加入下载管理');
  await page.getByRole('button', { name: '下载列表', exact: true }).click();
}
async function save(page: Page, name = 'sample.bin') {
  const downloaded = page.waitForEvent('download');
  await card(page, name).getByRole('button', { name: '保存到设备', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe(name);
  return readFile((await download.path())!);
}

test('pauses and resumes after reload, preserves complete bytes and deletes the cached download', async ({ page }) => {
  await open(page);
  await enqueue(page);
  await expect.poll(() => card(page).getByRole('progressbar').getAttribute('value')).not.toBe('0');
  await card(page).getByRole('button', { name: '暂停', exact: true }).click();
  await expect(card(page)).toContainText('已暂停');
  const before = await card(page).getByRole('progressbar').getAttribute('value');
  await page.reload();
  await expect(card(page)).toContainText('已暂停');
  await expect(card(page).getByRole('progressbar')).toHaveAttribute('value', before!);
  await card(page).getByRole('button', { name: '继续下载' }).click();
  await expect(card(page)).toContainText('文件已就绪');
  expect(await page.evaluate(() => window.downloadFixture.offsets[0])).toBeGreaterThan(0);
  const content = await save(page);
  expect(createHash('sha256').update(content).digest('hex'))
    .toBe(createHash('sha256').update(Buffer.alloc(4 * 1024 * 1024, 'A')).digest('hex'));
  await card(page).getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click();
  await expect(card(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('还没有下载任务')).toBeVisible();
});

test('keeps preview downloads running between pages and isolates accounts', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '预览文件' }).click();
  await page.getByRole('button', { name: '下载', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(card(page)).toContainText('下载中');
  await page.getByRole('button', { name: '切换页面' }).click();
  await expect.poll(() => page.evaluate(() => window.downloadFixture.closes)).toBe(1);
  await page.getByRole('button', { name: '切换页面' }).click();
  await expect(card(page)).toContainText('文件已就绪');
  await page.getByRole('button', { name: '切换用户' }).click();
  await expect(card(page)).toHaveCount(0);
  await page.getByRole('button', { name: '切换用户' }).click();
  await expect(card(page)).toContainText('文件已就绪');
});

test('file download cards show managed progress and preserve pause and resume actions', async ({ page }, info) => {
  await open(page);
  await page.getByRole('button', { name: '预览文件' }).click();
  const sheet = page.locator('.chat-download-sheet');
  await sheet.getByRole('button', { name: '下载', exact: true }).click();
  const progress = sheet.getByRole('progressbar', { name: '下载进度', exact: true });
  await expect.poll(() => progress.getAttribute('value')).toMatch(/^[1-9]/);
  await sheet.getByRole('button', { name: '暂停下载', exact: true }).click();
  await expect(sheet.locator('.file-download-progress-heading')).toContainText('已暂停');
  const checkpoint = await progress.getAttribute('value');
  await page.screenshot({ path: `../../.codex-tmp/file-download-paused-${info.project.name}.png` });
  await sheet.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '预览文件' }).click();
  await expect(progress).toHaveAttribute('value', checkpoint!);
  await sheet.getByRole('button', { name: '继续下载', exact: true }).click();
  await expect(sheet.getByRole('button', { name: '保存到设备', exact: true })).toBeEnabled();
  await expect(progress).toHaveAttribute('value', '100');
  const saving = page.waitForEvent('download');
  await sheet.getByRole('button', { name: '保存到设备', exact: true }).click();
  expect(await readFile((await (await saving).path())!)).toEqual(Buffer.alloc(4 * 1024 * 1024, 'A'));
});

test('uses five concurrent blocks by default and applies administrator changes while downloading', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.downloadFixture.size = 16 * 1024 * 1024; });
  await enqueue(page);
  await expect.poll(() => page.evaluate(() => window.downloadFixture.peak)).toBe(5);
  await page.evaluate(() => window.downloadFixture.windowSize(2));
  await expect.poll(() => page.evaluate(() => window.downloadFixture.active)).toBe(2);
  await page.evaluate(() => window.downloadFixture.windowSize(8));
  await expect.poll(() => page.evaluate(() => window.downloadFixture.peak)).toBe(8);
  await card(page).getByRole('button', { name: '暂停', exact: true }).click();
  await expect(card(page)).toContainText('已暂停');
});

test('pauses on disconnect and removes an active task without restoring a late response', async ({ page }) => {
  await open(page);
  await enqueue(page);
  await expect.poll(() => card(page).getByRole('progressbar').getAttribute('value')).not.toBe('0');
  await page.getByRole('button', { name: '断开电脑' }).click();
  await expect(card(page)).toContainText('已暂停');
  await expect(card(page).getByRole('button', { name: '继续下载' })).toBeDisabled();
  await page.getByRole('button', { name: '连接电脑' }).click();
  await card(page).getByRole('button', { name: '继续下载' }).click();
  await expect(card(page)).toContainText('下载中');
  await card(page).getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click();
  await expect(card(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.downloadFixture.closes)).toBe(2);
  await page.reload();
  await expect(page.getByText('还没有下载任务')).toBeVisible();
});

test('rejects corrupt chunks and restarts when a partially downloaded file changes', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.downloadFixture.corrupt = true; });
  await enqueue(page);
  await expect(card(page)).toContainText('下载失败');
  await expect(card(page).getByRole('progressbar')).toHaveAttribute('value', '0');
  await page.evaluate(() => { window.downloadFixture.corrupt = false; });
  await card(page).getByRole('button', { name: '继续下载' }).click();
  await expect.poll(() => card(page).getByRole('progressbar').getAttribute('value')).not.toBe('0');
  await card(page).getByRole('button', { name: '暂停', exact: true }).click();
  await expect(card(page)).toContainText('已暂停');
  await page.evaluate(() => { window.downloadFixture.revision = 'second'; window.downloadFixture.offsets = []; });
  await card(page).getByRole('button', { name: '继续下载' }).click();
  await expect(card(page)).toContainText('文件已就绪');
  expect(await page.evaluate(() => window.downloadFixture.offsets[0])).toBe(0);
  expect(await save(page)).toEqual(Buffer.alloc(4 * 1024 * 1024, 'B'));
});

test('browses computer folders, returns one level and saves empty files without overflow', async ({ page }, info) => {
  await open(page);
  await page.getByRole('button', { name: '此电脑', exact: true }).click();
  await page.getByRole('button', { name: '打开文件夹：C:', exact: true }).click();
  await page.getByRole('button', { name: '打开文件夹：folder', exact: true }).click();
  await page.getByRole('button', { name: '返回上一级' }).click();
  await expect(page.getByRole('button', { name: '打开文件夹：folder', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '下载：empty.txt', exact: true }).click();
  await page.getByRole('button', { name: '下载列表' }).click();
  await expect(card(page, 'empty.txt')).toContainText('文件已就绪');
  expect((await save(page, 'empty.txt')).length).toBe(0);
  await page.locator('.downloads-page').evaluate(node => { node.style.fontSize = '24px'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(page.viewportSize()!.width);
  await page.screenshot({ path: `../../.codex-tmp/web-downloads-${info.project.name}.png`, fullPage: true });
});

test('bulk uses bounded binary records, validates content and exports exact bytes', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.downloadFixture.bulk = true; window.downloadFixture.size = 2 * 1024 * 1024 + 17; });
  await enqueue(page);
  await expect(card(page)).toContainText('文件已就绪');
  const content = await save(page);
  expect(content).toEqual(Buffer.alloc(2 * 1024 * 1024 + 17, 'A'));
  expect(await page.evaluate(() => window.downloadFixture.recordBytes)).toBeLessThanOrEqual(16 * 1024);
  await expect(card(page)).toContainText('已开始保存');
  await expect(card(page)).not.toContainText('已完成');
});

test('bulk revalidates persisted blocks after reload and replaces only a damaged block', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.downloadFixture.bulk = true; window.downloadFixture.size = 8 * 1024 * 1024; });
  await enqueue(page);
  await expect.poll(() => card(page).getByRole('progressbar').getAttribute('value')).not.toBe('0');
  await card(page).getByRole('button', { name: '暂停', exact: true }).click();
  await expect(card(page)).toContainText('已暂停');
  await page.reload();
  await page.evaluate(async () => {
    window.downloadFixture.bulk = true; window.downloadFixture.size = 8 * 1024 * 1024;
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('codex-switch.web.downloads.v1', 2);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const transaction = open.result.transaction('chunks', 'readwrite');
        const cursor = transaction.objectStore('chunks').openCursor();
        cursor.onsuccess = () => {
          if (cursor.result) cursor.result.update({ ...cursor.result.value, blob: new Blob([new Uint8Array(1024)]) });
        };
        transaction.oncomplete = () => { open.result.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  });
  await card(page).getByRole('button', { name: '继续下载' }).click();
  await expect(card(page)).toContainText('文件已就绪');
  expect(await page.evaluate(() => window.downloadFixture.offsets.includes(0))).toBe(true);
  expect(await save(page)).toEqual(Buffer.alloc(8 * 1024 * 1024, 'A'));
});

test('bulk rejects corrupted authentication and supports empty files', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.downloadFixture.bulk = true; window.downloadFixture.cipherFailure = true; });
  await enqueue(page);
  await expect(card(page)).toContainText('下载失败');
  await page.evaluate(() => { window.downloadFixture.cipherFailure = false; });
  await enqueue(page, 'empty.txt');
  await expect(card(page, 'empty.txt')).toContainText('文件已就绪');
  expect((await save(page, 'empty.txt')).length).toBe(0);
});

test('bulk limits hash retries and refuses a corrupted ready file at export', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    window.downloadFixture.bulk = true; window.downloadFixture.size = 31; window.downloadFixture.corrupt = true;
  });
  await enqueue(page);
  await expect(card(page)).toContainText('下载失败');
  expect(await page.evaluate(() => window.downloadFixture.offsets)).toEqual([0, 0, 0]);
  await page.evaluate(() => { window.downloadFixture.corrupt = false; });
  await card(page).getByRole('button', { name: '继续下载' }).click();
  await expect(card(page)).toContainText('文件已就绪');
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('codex-switch.web.downloads.v1', 2);
      request.onsuccess = () => {
        const tx = request.result.transaction('chunks', 'readwrite');
        const cursor = tx.objectStore('chunks').openCursor();
        cursor.onsuccess = () => {
          if (cursor.result) cursor.result.update({ ...cursor.result.value, blob: new Blob([new Uint8Array(31)]) });
        };
        tx.oncomplete = () => { request.result.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
    });
  });
  let exported = false; page.on('download', () => { exported = true; });
  await card(page).getByRole('button', { name: '保存到设备' }).click();
  await expect(card(page)).toContainText('文件校验失败');
  expect(exported).toBe(false);
});

test('bulk automatically resumes missing verified blocks through relay after a path switch', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.downloadFixture.bulk = true; window.downloadFixture.size = 4 * 1024 * 1024; });
  await enqueue(page);
  await expect.poll(() => card(page).getByRole('progressbar').getAttribute('value')).not.toBe('0');
  await page.getByRole('button', { name: '切换连接方式' }).click();
  await expect(card(page)).toContainText('正在重试');
  await expect(card(page)).toContainText('文件已就绪');
  expect(await save(page)).toEqual(Buffer.alloc(4 * 1024 * 1024, 'A'));
});

test('a manual pause during recovery remains paused until the user resumes', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.downloadFixture.bulk = true; window.downloadFixture.size = 4 * 1024 * 1024; });
  await enqueue(page);
  await expect.poll(() => card(page).getByRole('progressbar').getAttribute('value')).not.toBe('0');
  await page.getByRole('button', { name: '切换连接方式' }).click();
  await expect(card(page)).toContainText('正在重试');
  await card(page).getByRole('button', { name: '暂停', exact: true }).click();
  await expect(card(page)).toContainText('已暂停');
  const requests = await page.evaluate(() => window.downloadFixture.offsets.length);
  await page.waitForTimeout(1500);
  await expect(card(page)).toContainText('已暂停');
  expect(await page.evaluate(() => window.downloadFixture.offsets.length)).toBe(requests);
  await card(page).getByRole('button', { name: '继续下载' }).click();
  await expect(card(page)).toContainText('文件已就绪');
});

test('a 32 MiB relay download survives background direct attempts and verifies the saved hash', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    window.downloadFixture.bulk = true; window.downloadFixture.size = 32 * 1024 * 1024;
    window.downloadFixture.delay = 20; window.downloadFixture.downloadLimit(300);
  });
  await page.getByRole('button', { name: '切换连接方式' }).click();
  await enqueue(page);
  await expect.poll(() => card(page).getByRole('progressbar').getAttribute('value')).not.toBe('0');
  await page.evaluate(() => { for (let index = 0; index < 5; index++) window.downloadFixture.directAttempt(); });
  await expect(card(page)).toContainText('文件已就绪', { timeout: 30_000 });
  expect(createHash('sha256').update(await save(page)).digest('hex'))
    .toBe(createHash('sha256').update(Buffer.alloc(32 * 1024 * 1024, 'A')).digest('hex'));
});

test('bulk aborts a failed final save and makes missing stored data downloadable again', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    window.downloadFixture.bulk = true; window.downloadFixture.size = 31;
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () => ({
      createWritable: async () => ({ write: async () => undefined,
        close: async () => { throw new Error('Storage full'); },
        abort: async () => {
          document.body.dataset.abortedSaves = String(Number(document.body.dataset.abortedSaves ?? 0) + 1);
        },
      }),
    }) });
  });
  await enqueue(page);
  await expect(card(page)).toContainText('文件已就绪');
  await card(page).getByRole('button', { name: '保存到设备' }).click();
  await expect(card(page)).toContainText('保存未完成');
  await expect(page.locator('body')).toHaveAttribute('data-aborted-saves', '1');
  await expect(card(page)).not.toContainText('已完成');
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('codex-switch.web.downloads.v1', 2);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const tx = request.result.transaction('chunks', 'readwrite');
        tx.objectStore('chunks').clear();
        tx.oncomplete = () => { request.result.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
    });
  });
  await card(page).getByRole('button', { name: '保存到设备' }).click();
  await expect(card(page)).toContainText('文件校验失败');
  await expect(card(page).getByRole('button', { name: '继续下载' })).toBeEnabled();
  await expect(page.locator('body')).toHaveAttribute('data-aborted-saves', '2');
});

test('legacy resume survives interrupted migration of chunks crossing bulk boundaries', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    await window.downloadFixture.seedLegacy({ size: 8 * 1024 * 1024 + 17,
      received: 5 * 1024 * 1024 + 12345, chunkBytes: 300001 });
    await window.downloadFixture.coalesceBeforeReload();
  });
  await page.reload();
  await expect(card(page)).toContainText('已暂停');
  await page.evaluate(() => {
    window.downloadFixture.bulk = true; window.downloadFixture.size = 8 * 1024 * 1024 + 17;
    window.downloadFixture.delay = 30;
  });
  await card(page).getByRole('button', { name: '继续下载' }).click();
  await expect(card(page)).toContainText('文件已就绪');
  expect(await page.evaluate(() => window.downloadFixture.offsets)).toEqual([5, 6, 7, 8].map(n => n * 1024 * 1024));
  expect(await save(page)).toEqual(Buffer.alloc(8 * 1024 * 1024 + 17, 'A'));
});

test('legacy migration preserves valid blocks around corruption and rewrites only invalid data', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    await window.downloadFixture.seedLegacy({ size: 4 * 1024 * 1024 + 17,
      received: 3 * 1024 * 1024 + 12345, chunkBytes: 300001, corruptBlock: 1 });
  });
  await page.reload();
  await page.evaluate(() => {
    window.downloadFixture.bulk = true; window.downloadFixture.size = 4 * 1024 * 1024 + 17;
    window.downloadFixture.delay = 30;
  });
  await card(page).getByRole('button', { name: '继续下载' }).click();
  await expect(card(page)).toContainText('文件已就绪');
  expect(await page.evaluate(() => window.downloadFixture.offsets)).toEqual([1, 3, 4].map(n => n * 1024 * 1024));
  expect(await save(page)).toEqual(Buffer.alloc(4 * 1024 * 1024 + 17, 'A'));
});

test('legacy migration keeps a verified final partial block and removes an obsolete source tail', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    await window.downloadFixture.seedLegacy({ size: 2 * 1024 * 1024,
      received: 2 * 1024 * 1024, chunkBytes: 300001 });
  });
  await page.reload();
  await page.evaluate(() => {
    window.downloadFixture.bulk = true; window.downloadFixture.size = 1024 * 1024 + 17;
  });
  await card(page).getByRole('button', { name: '继续下载' }).click();
  await expect(card(page)).toContainText('文件已就绪');
  expect(await page.evaluate(() => window.downloadFixture.offsets)).toEqual([]);
  expect(await save(page)).toEqual(Buffer.alloc(1024 * 1024 + 17, 'A'));
});

test('pausing bulk then losing the binary path preserves its checkpoint until recovery', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.downloadFixture.bulk = true; window.downloadFixture.size = 8 * 1024 * 1024; });
  await enqueue(page);
  await expect.poll(() => card(page).getByRole('progressbar').getAttribute('value')).not.toBe('0');
  await card(page).getByRole('button', { name: '暂停', exact: true }).click();
  await expect(card(page)).toContainText('已暂停');
  const before = await page.evaluate(async () => (await window.downloadFixture.saved())[0]);
  expect(before.received).toBeGreaterThan(0);
  await page.evaluate(() => { window.downloadFixture.bulk = false; window.downloadFixture.offsets = []; });
  await card(page).getByRole('button', { name: '继续下载' }).click();
  await expect(card(page)).toContainText('正在重试');
  const retrying = await page.evaluate(async () => (await window.downloadFixture.saved())[0]);
  expect(retrying.received).toBe(before.received);
  expect(retrying.checkpoint).toEqual(before.checkpoint);
  expect(await page.evaluate(() => window.downloadFixture.offsets)).toEqual([]);
  await card(page).getByRole('button', { name: '暂停', exact: true }).click();
  await expect(card(page)).toContainText('已暂停');
  await page.reload();
  await page.evaluate(() => {
    window.downloadFixture.bulk = true; window.downloadFixture.size = 8 * 1024 * 1024;
    window.downloadFixture.delay = 30;
  });
  await card(page).getByRole('button', { name: '继续下载' }).click();
  await expect(card(page)).toContainText('文件已就绪');
  const offsets = await page.evaluate(() => window.downloadFixture.offsets);
  for (const block of before.checkpoint!.committed) expect(offsets).not.toContain(block * 1024 * 1024);
  expect(await save(page)).toEqual(Buffer.alloc(8 * 1024 * 1024, 'A'));
});
