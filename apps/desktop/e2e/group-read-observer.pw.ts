import { expect, test, type Page } from '@playwright/test';
import type {} from './group-read-observer-harness';

test.use({ viewport: { width: 800, height: 600 } });

async function open(page: Page, parameters = '') {
  await page.goto(`/e2e/group-read-observer-harness.html?${parameters}`);
  await expect(page.locator('#message')).toBeAttached();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
    resolve();
  }))));
}

const reads = (page: Page) => page.evaluate(() => window.groupReadObserverFixture.events.filter(e => e.visible));
async function scroll(page: Page, top: number, container = false) {
  return page.evaluate(({ top, container }) => {
    if (container) document.getElementById('scroll-root')!.scrollTop = top;
    else window.scrollTo(0, top);
    return performance.now();
  }, { top, container });
}

for (const height of [1800, 900, 200]) {
  test(`${height}px message starts a 500ms read after entering in two steps`, async ({ page }) => {
    await open(page, `height=${height}`);
    await scroll(page, height === 200 ? 350 : 500);
    await page.waitForTimeout(650);
    expect(await reads(page)).toEqual([]);
    const entered = await scroll(page, height === 200 ? 450 : 800);
    await page.waitForTimeout(300);
    expect(await reads(page)).toEqual([]);
    await expect.poll(() => reads(page)).toHaveLength(1);
    expect((await reads(page))[0].at - entered).toBeGreaterThanOrEqual(480);
  });
}

test('leaving sufficient visibility cancels the timer even while still intersecting', async ({ page }) => {
  await open(page);
  await scroll(page, 500); await page.waitForTimeout(100);
  await scroll(page, 800); await page.waitForTimeout(250);
  await scroll(page, 550); await page.waitForTimeout(650);
  expect(await reads(page)).toEqual([]);
  await scroll(page, 800);
  await expect.poll(() => reads(page)).toHaveLength(1);
  await scroll(page, 0);
  await expect.poll(() => page.evaluate(() => window.groupReadObserverFixture.events.at(-1)?.visible)).toBe(false);
});

test('continued visible scrolling does not restart the dwell timer or poll while idle', async ({ page }) => {
  await open(page);
  await scroll(page, 800);
  for (let step = 1; step <= 7; step++) {
    await page.waitForTimeout(100); await scroll(page, 800 + step * 10);
  }
  expect(await reads(page)).toHaveLength(1);
  await page.waitForTimeout(100);
  await page.locator('#message').evaluate(node => {
    const measure = node.getBoundingClientRect.bind(node);
    node.dataset.measurements = '0';
    node.getBoundingClientRect = () => {
      node.dataset.measurements = String(Number(node.dataset.measurements) + 1);
      return measure();
    };
  });
  await page.waitForTimeout(650);
  await expect(page.locator('#message')).toHaveAttribute('data-measurements', '0');
});

test('a small scroll container uses its own available height and responds to resizing', async ({ page }) => {
  await open(page, 'container=240&history');
  await scroll(page, 720, true); await page.waitForTimeout(650);
  expect(await reads(page)).toEqual([]);
  await scroll(page, 820, true);
  await page.waitForTimeout(250);
  // The message now has only 40px visible: resizing must cancel the pending read without scrolling.
  await page.locator('#scroll-root').evaluate(node => { node.style.height = '120px'; });
  await page.waitForTimeout(650); expect(await reads(page)).toEqual([]);
  await page.locator('#scroll-root').evaluate(node => { node.style.height = '300px'; });
  await expect.poll(() => reads(page)).toHaveLength(1);
  expect((await reads(page))[0].history).toBe(true);
});

test('content height changes invalidate visibility and restart a full dwell', async ({ page }) => {
  await open(page, 'height=200');
  await scroll(page, 450); await page.waitForTimeout(250);
  await page.locator('#message').evaluate(node => { node.style.height = '1800px'; });
  await page.waitForTimeout(650); expect(await reads(page)).toEqual([]);
  await page.locator('#message').evaluate(node => { node.style.height = '200px'; });
  await page.waitForTimeout(250); expect(await reads(page)).toEqual([]);
  await expect.poll(() => reads(page)).toHaveLength(1);
});

test('layout movement and viewport resize work without a scroll gesture', async ({ page }) => {
  await open(page);
  await page.locator('#spacer').evaluate(node => { node.style.height = '400px'; });
  await page.waitForTimeout(650); expect(await reads(page)).toEqual([]);
  await page.setViewportSize({ width: 800, height: 900 });
  await expect.poll(() => reads(page)).toHaveLength(1);
});

test('a preceding layout shift crosses the effective threshold without resizing the bubble', async ({ page }) => {
  await open(page);
  await page.locator('#spacer').evaluate(node => { node.style.height = '400px'; });
  await page.waitForTimeout(650); expect(await reads(page)).toEqual([]);
  await page.locator('#spacer').evaluate(node => { node.style.height = '200px'; });
  await expect.poll(() => reads(page)).toHaveLength(1);
});

test('nested clipping uses the available height independently of horizontal area', async ({ page }) => {
  await open(page, 'container=240&clip');
  await scroll(page, 810, true); await page.waitForTimeout(650);
  expect(await reads(page)).toEqual([]);
  await scroll(page, 850, true);
  await expect.poll(() => reads(page)).toHaveLength(1);
});

for (const kind of ['own', 'unsupported', 'direct']) {
  test(`${kind} messages never start a group read`, async ({ page }) => {
    await open(page, `${kind}&height=200`);
    await scroll(page, 800); await page.waitForTimeout(650);
    expect(await reads(page)).toEqual([]);
  });
}

test('unmount cancels a pending read', async ({ page }) => {
  await open(page); await scroll(page, 800); await page.waitForTimeout(250);
  await page.evaluate(() => window.groupReadObserverFixture.unmount());
  await page.waitForTimeout(650); expect(await reads(page)).toEqual([]);
});
