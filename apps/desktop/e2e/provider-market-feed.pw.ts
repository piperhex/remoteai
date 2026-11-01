import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { expectMarketDialogLayout, fixtureItem, setupMarket } from './provider-market-support';
import type { MarketPage, MarketRequest } from '../../../shared/provider-market/types';

type ListRequest = Extract<MarketRequest, { type: 'list' }>;
const PAGE_SIZE = 40;
const TOTAL = 85;
test.use({ viewport: { width: 1280, height: 1000 } });
const items = (offset: number, count: number, prefix = 'Provider') => Array.from({ length: count }, (_, index) => ({
  ...fixtureItem(), id: `${prefix}-${offset + index}`, name: `${prefix} ${offset + index}`,
}));
const resultFor = (page: number): MarketPage => ({ total: TOTAL,
  items: items((page - 1) * PAGE_SIZE, Math.min(PAGE_SIZE, TOTAL - (page - 1) * PAGE_SIZE)) });

async function openMarket(page: Page, mode: string) {
  await page.goto(`/e2e/provider-market-harness.html?mode=${mode}`);
  await page.locator('.provider-market-button').first().click();
}

async function nearBottom(page: Page) {
  await page.locator('.provider-market-modal .ant-modal-body').evaluate((node) => {
    node.scrollTop = node.scrollHeight - node.clientHeight - 120;
  });
}

async function captureMarket(page: Page, info: TestInfo, name: string) {
  await page.locator('.provider-market-modal .ant-modal-content').screenshot({ path: info.outputPath(name) });
}

for (const mode of ['local', 'hosted']) {
  test(`${mode}: preloads at the bottom, appends once, and places actions at the top right`, async ({ page }, info) => {
    const requests: ListRequest[] = [];
    let completeNext!: (value: MarketPage) => void;
    const nextPage = new Promise<MarketPage>((resolve) => { completeNext = resolve; });
    await setupMarket(page, mode, true, async (request) => {
      requests.push(request);
      return request.page === 2 ? nextPage : resultFor(request.page);
    });
    await openMarket(page, mode);
    const cards = page.locator('.pm-card');
    await expect(cards).toHaveCount(PAGE_SIZE);
    await expectMarketDialogLayout(page);
    expect(await page.locator('.ant-modal-body').evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    await expect(page.getByRole('button', { name: 'Previous', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
    const card = await cards.first().boundingBox();
    const actions = await cards.first().locator('.pm-card-actions').boundingBox();
    const metadata = await cards.first().locator(':scope > .ant-space').boundingBox();
    expect(actions!.x + actions!.width).toBeCloseTo(card!.x + card!.width - 17, 0);
    expect(actions!.y + actions!.height).toBeLessThan(metadata!.y);
    await captureMarket(page, info, `${mode}-card-actions.png`);
    expect(requests.map((request) => request.page)).toEqual([1]);
    await nearBottom(page);
    await expect.poll(() => requests.length).toBe(2);
    const beats = Number(await page.getByTestId('beats').textContent());
    await nearBottom(page);
    await expect.poll(async () => Number(await page.getByTestId('beats').textContent())).toBeGreaterThan(beats + 3);
    await expect(cards).toHaveCount(PAGE_SIZE);
    expect(requests).toHaveLength(2);
    await page.locator('.pm-feed-tail').scrollIntoViewIfNeeded();
    await captureMarket(page, info, `${mode}-preloading.png`);
    completeNext(resultFor(2));
    await expect(cards).toHaveCount(80);
    await nearBottom(page);
    await expect(cards).toHaveCount(TOTAL);
    await expect(page.locator('.pm-feed-tail')).toHaveCount(0);
    expect(requests.map((request) => request.page)).toEqual([1, 2, 3]);
    await cards.last().scrollIntoViewIfNeeded();
    await captureMarket(page, info, `${mode}-all-loaded.png`);
  });
}

test('failed pages retain cards, retry the same page, and reset after search and filters', async ({ page }, info) => {
  const requests: ListRequest[] = [];
  let failNext = true;
  await setupMarket(page, 'local', true, async (request) => {
    requests.push(request);
    if (request.search) return { items: items(0, 3, request.search), total: 3 };
    if (request.scope === 'mine') return { items: items(0, 1, 'Mine'), total: 1 };
    if (request.page === 2 && failNext) { failNext = false; throw new Error('unavailable'); }
    return resultFor(request.page);
  });
  await openMarket(page, 'local');
  await expect(page.locator('.pm-card')).toHaveCount(PAGE_SIZE);
  await nearBottom(page);
  const retry = page.locator('.pm-feed-tail').getByRole('button', { name: 'Retry', exact: true });
  await expect(retry).toBeVisible();
  await expect(page.locator('.pm-card')).toHaveCount(PAGE_SIZE);
  await retry.scrollIntoViewIfNeeded();
  await captureMarket(page, info, 'local-retry.png');
  await nearBottom(page);
  expect(requests.map((request) => request.page)).toEqual([1, 2]);
  await retry.click();
  await expect(page.locator('.pm-card')).toHaveCount(80);
  expect(requests.map((request) => request.page)).toEqual([1, 2, 2]);
  await page.getByRole('searchbox').fill('Filtered');
  await page.getByRole('searchbox').press('Enter');
  await expect(page.locator('.pm-card')).toHaveCount(3);
  expect(requests.at(-1)).toMatchObject({ page: 1, search: 'Filtered' });
  await page.getByRole('searchbox').fill('');
  await page.getByRole('searchbox').press('Enter');
  await expect(page.locator('.pm-card')).toHaveCount(PAGE_SIZE);
  await page.getByText('My publications', { exact: true }).click();
  await expect(page.locator('.pm-card')).toHaveCount(1);
  expect(requests.at(-1)).toMatchObject({ page: 1, scope: 'mine', search: '' });
  await expect(page.getByRole('button', { name: 'Mine 0', exact: true })).toBeVisible();
});

test('a narrow dark card keeps actions above its metadata without overflowing', async ({ page }, info) => {
  await setupMarket(page, 'hosted');
  await page.setViewportSize({ width: 640, height: 800 });
  await page.goto('/e2e/provider-market-harness.html?mode=hosted&dark=1');
  await page.locator('.provider-market-button').first().click();
  const card = page.locator('.pm-card');
  await expect(card).toHaveCount(1);
  const actions = await card.locator('.pm-card-actions').boundingBox();
  const metadata = await card.locator(':scope > .ant-space').boundingBox();
  expect(actions!.y + actions!.height).toBeLessThan(metadata!.y);
  expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await captureMarket(page, info, 'narrow-dark-card.png');
});
