import { expect, test } from '@playwright/test';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { historyTurn, metrics, openHistory, PAGE_SIZE, scrollToMessage, settle } from './history-window-fixture';

const baseline = process.env.HISTORY_WINDOW_BASELINE === '1';
const evidence = fileURLToPath(new URL('../../../.codex-tmp/history-window-evidence/', import.meta.url));
const imageFixture = fileURLToPath(new URL('../../desktop/src-tauri/icons/128x128.png', import.meta.url));

test('long paged history keeps a bounded rich-content window and accessible stable rows', async ({ page }, info) => {
  const { loaded } = await openHistory(page);
  const samples = [await metrics(page)];
  const viewport = page.locator('.chat-messages');
  for (let batch = 1; batch <= 4; batch++) {
    await viewport.evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')); });
    await expect.poll(loaded).toBe(batch);
    await expect(page.locator('[data-message-id]')).toHaveCount(PAGE_SIZE * (batch + 1));
    await settle(page);
    samples.push(await metrics(page));
  }
  await scrollToMessage(page, 'message-150');
  const top = (await page.locator('[data-message-id="message-150"]').boundingBox())!.y;
  await page.waitForTimeout(250);
  expect(Math.abs((await page.locator('[data-message-id="message-150"]').boundingBox())!.y - top)).toBeLessThan(3);
  const ids = await page.locator('[data-message-id]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-message-id')));
  expect(new Set(ids).size).toBe(300);
  expect(ids).toEqual(Array.from({ length: 300 }, (_, i) => `message-${i}`));
  if (!baseline && info.project.name === 'mobile') {
    for (const sample of samples) {
      expect(sample.rich).toBeLessThan(40); expect(sample.peakRich).toBeLessThan(40);
    }
  }
  const frames = await viewport.evaluate(async node => {
    const durations: number[] = [];
    let previous = performance.now();
    for (let i = 0; i < 60; i++) {
      node.scrollTop += i < 30 ? 80 : -80;
      await new Promise(requestAnimationFrame);
      const current = performance.now(); durations.push(current - previous); previous = current;
    }
    return durations.sort((a, b) => a - b);
  });
  await scrollToMessage(page, 'message-150');
  const reading = await metrics(page);
  if (!baseline && info.project.name === 'mobile') expect(reading.peakRich).toBeLessThan(40);
  mkdirSync(evidence, { recursive: true });
  const phase = baseline ? 'before' : 'after';
  writeFileSync(`${evidence}/${info.project.name}-${phase}.json`, JSON.stringify({ samples, reading,
    frameMs: { median: frames[30], p95: frames[57], max: frames[59] },
    method: 'Bundled Chromium, Vite dev harness, 60 rows + 4 x 60 rows; forced GC; 60 RAF scroll steps',
  }, null, 2));
  await page.screenshot({ path: `${evidence}/${info.project.name}-${phase}-reading.png` });
  await page.locator('.chat-scroll-bottom').click();
  await expect.poll(() => viewport.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight))
    .toBeLessThan(3);
  await expect(page.locator('[data-message-id="message-299"] .chat-markdown')).toBeVisible();
  await page.screenshot({ path: `${evidence}/${info.project.name}-${phase}-bottom.png` });
});

test('preserves prepend anchors, streams while reading, and follows the explicit bottom jump', async ({ page }, info) => {
  test.skip(baseline || info.project.name !== 'mobile', 'Mobile window anchor coverage');
  const { value } = await openHistory(page, 0);
  await scrollToMessage(page, 'message-24');
  const anchor = page.locator('[data-message-id="message-24"]');
  const top = (await anchor.boundingBox())!.y;
  value.turns = [...Array.from({ length: 60 }, (_, i) => historyTurn(i - 60)), ...value.turns!];
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent('display-fixture', { detail })), value);
  await settle(page);
  expect(Math.abs((await anchor.boundingBox())!.y - top)).toBeLessThan(3);
  const live = historyTurn(60);
  live.status = 'inProgress'; live.items[0].status = 'inProgress';
  value.turns.push(live);
  for (let i = 0; i < 12; i++) {
    live.items[0].text += `\n\n流式片段 ${i}`;
    await page.evaluate(detail => window.dispatchEvent(new CustomEvent('display-fixture', { detail })), value);
    await settle(page);
    expect(Math.abs((await anchor.boundingBox())!.y - top)).toBeLessThan(3);
  }
  await page.screenshot({ path: `${evidence}/${info.project.name}-stream-reading.png` });
  await scrollToMessage(page, 'message--50');
  await scrollToMessage(page, 'message-24');
  await page.locator('.chat-scroll-bottom').click();
  const viewport = page.locator('.chat-messages');
  await expect.poll(() => viewport.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight))
    .toBeLessThan(3);
  await expect(page.getByText('流式片段 11', { exact: true })).toBeVisible();
  live.items[0].text += '\n\n最后一段';
  live.status = 'completed'; live.items[0].status = 'completed';
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent('display-fixture', { detail })), value);
  await expect(page.getByText('最后一段', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${evidence}/${info.project.name}-stream-bottom.png` });
});

test('keeps a reading anchor on row growth, keyboard-sized resize and width changes', async ({ page }, info) => {
  test.skip(baseline || info.project.name !== 'mobile', 'Mobile window anchor coverage');
  await openHistory(page, 0);
  await scrollToMessage(page, 'message-24');
  const anchor = page.locator('[data-message-id="message-24"]');
  const top = (await anchor.boundingBox())!.y;
  // A late decoded image or expanding disclosure changes a mounted row above the reading anchor.
  const preceding = page.locator('[data-message-id="message-23"] .chat-markdown');
  await preceding.evaluate(node => { (node as HTMLElement).style.paddingBottom = '180px'; });
  await settle(page);
  expect(Math.abs((await anchor.boundingBox())!.y - top)).toBeLessThan(3);
  if (info.project.name === 'mobile') {
    await page.setViewportSize({ width: 390, height: 520 });
    await settle(page);
    expect(Math.abs((await anchor.boundingBox())!.y - top)).toBeLessThan(3);
    await page.screenshot({ path: `${evidence}/mobile-keyboard-height.png` });
    await page.setViewportSize({ width: 430, height: 844 });
    await settle(page);
    expect(Math.abs((await anchor.boundingBox())!.y - top)).toBeLessThan(3);
    await page.screenshot({ path: `${evidence}/mobile-width-change.png` });
    await page.setViewportSize({ width: 1280, height: 900 });
    await settle(page);
    await expect(page.locator('[data-mobile-history-content]')).toHaveCount(0);
    await expect(page.locator('.chat-markdown').first()).toBeAttached();
    expect(Math.abs((await anchor.boundingBox())!.y - top)).toBeLessThan(3);
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page);
    await expect(page.locator('[data-mobile-history-content]')).toHaveCount(60);
    await expect.poll(() => page.locator('.chat-markdown').count()).toBeLessThan(40);
    expect(Math.abs((await anchor.boundingBox())!.y - top)).toBeLessThan(3);
  }
});

test('retains expanded quotes across recycling and keeps selected text attached', async ({ page }, info) => {
  test.skip(baseline || info.project.name !== 'mobile', 'Mobile recycling');
  const { value } = await openHistory(page, 0);
  value.turns![24].items[0] = { id: 'message-24', type: 'userMessage',
    text: '引用 AI 回答：\n> A quoted passage\n\nPlease review this quote.' };
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent('display-fixture', { detail })), value);
  await scrollToMessage(page, 'message-24');
  const row = page.locator('[data-message-id="message-24"]');
  const details = row.locator('details');
  await details.locator('summary').click();
  await expect(details).toHaveAttribute('open', '');
  await page.getByRole('textbox').focus();
  await scrollToMessage(page, 'message-50');
  await expect(row.locator('.chat-markdown')).toHaveCount(0);
  await scrollToMessage(page, 'message-24');
  await expect(details).toHaveAttribute('open', '');
  await expect(details.locator('blockquote')).toBeVisible();
  await page.screenshot({ path: `${evidence}/mobile-remounted-expanded.png` });
  await row.locator('.chat-markdown').evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await scrollToMessage(page, 'message-50');
  await expect(row.locator('.chat-markdown')).toHaveCount(1);
  await page.evaluate(() => { getSelection()?.removeAllRanges(); document.dispatchEvent(new Event('selectionchange')); });
  await expect(row.locator('.chat-markdown')).toHaveCount(0);
});

test('keeps delayed images anchored and retains only the row owning an open preview', async ({ page }, info) => {
  test.skip(baseline || info.project.name !== 'mobile', 'Mobile image recycling');
  const { value } = await openHistory(page, 0);
  let releaseImage = () => {};
  await page.route('**/history-window-image.png', async route => {
    await new Promise<void>(resolve => { releaseImage = resolve; });
    await route.fulfill({ contentType: 'image/png', body: readFileSync(imageFixture) });
  });
  value.turns![23].items[0].text = '图片消息\n\n![加载后的图片](http://127.0.0.1:1432/history-window-image.png)';
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent('display-fixture', { detail })), value);
  await scrollToMessage(page, 'message-23');
  await expect(page.locator('[data-message-id="message-23"] img')).toBeAttached();
  await page.locator('[data-message-id="message-23"] .chat-image').focus();
  await scrollToMessage(page, 'message-24');
  const anchor = page.locator('[data-message-id="message-24"]');
  const top = (await anchor.boundingBox())!.y;
  releaseImage();
  await expect.poll(() => page.locator('[data-message-id="message-23"] img')
    .evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(128);
  await settle(page);
  expect(Math.abs((await anchor.boundingBox())!.y - top)).toBeLessThan(3);
  await scrollToMessage(page, 'message-23');
  await page.locator('[data-message-id="message-23"] .chat-image').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  for (const id of [30, 40, 50]) await scrollToMessage(page, `message-${id}`);
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.locator('.chat-markdown').count()).toBeLessThan(15);
  await page.screenshot({ path: `${evidence}/mobile-image-preview.png` });
  await page.keyboard.press('Escape');
  await page.getByRole('textbox').focus();
  await expect(page.locator('[data-message-id="message-23"] .chat-markdown')).toHaveCount(0);
  await scrollToMessage(page, 'message-23');
  await expect(page.locator('[data-message-id="message-23"] img')).toBeVisible();
  await page.screenshot({ path: `${evidence}/mobile-remounted-image.png` });
});

for (const movement of [0, 180]) test(`preserves an asynchronous page anchor after ${movement}px of reader movement`,
  async ({ page }, info) => {
  test.skip(baseline || info.project.name !== 'mobile', 'Mobile paged history');
  await openHistory(page, 1);
  let finish = () => {};
  await page.route('**/display-history.json', async route => {
    await new Promise<void>(resolve => { finish = resolve; });
    await route.fulfill({ json: { turns: Array.from({ length: 60 }, (_, i) => historyTurn(i)), hasMore: false } });
  });
  await page.locator('.chat-messages').evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')); });
  await expect(page.locator('.chat-history-more button')).toBeDisabled();
  const anchor = page.locator('[data-message-id="message-60"]');
  await expect(anchor.locator('.chat-markdown')).toBeVisible();
  if (movement) await page.locator('.chat-messages').evaluate((node, offset) => {
    node.scrollTop += offset; node.dispatchEvent(new Event('scroll'));
  }, movement);
  await settle(page);
  const top = (await anchor.boundingBox())!.y;
  finish();
  await expect(page.locator('[data-message-id]')).toHaveCount(120);
  await settle(page);
  expect(Math.abs((await anchor.boundingBox())!.y - top)).toBeLessThan(3);
  await page.screenshot({ path: `${evidence}/mobile-prepend-anchor-${movement}.png` });
  await scrollToMessage(page, 'message-0');
  await expect(page.locator('[data-message-id="message-0"]')).toBeInViewport();
});
