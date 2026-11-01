import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const directory = '../../.codex-tmp/token-lifecycle';
const mode = process.env.TOKEN_BASELINE === '1' ? 'before' : 'after';
const observationMs = 5100;
const fields = ['entries', 'daily', 'breakdown', 'quota', 'renders', 'draws'] as const;
type Counts = Record<typeof fields[number], number>;
declare global {
  interface Window {
    __tokenMetrics: Counts;
    __tokenCount: (name: keyof Counts) => void;
    __tokenProbe: <T>(name: keyof Counts, load: () => Promise<T>) => Promise<T>;
    __tokenDelay: number;
  }
}
async function counts(page: Page) { return page.evaluate(() => ({ ...window.__tokenMetrics })); }
function difference(after: Counts, before: Counts): Counts {
  return Object.fromEntries(fields.map(key => [key, after[key] - before[key]])) as Counts;
}
async function observe(page: Page) {
  const before = await counts(page);
  await page.waitForTimeout(observationMs);
  return difference(await counts(page), before);
}

test('records unchanged observation windows and real chart work across panel lifecycle and independent pages',
  async ({ page, context }) => {
    mkdirSync(directory, { recursive: true });
    await context.addInitScript(() => {
      localStorage.setItem('codex-switch:language', 'en');
      localStorage.setItem('codex-switch:token-usage-refresh-seconds', '1');
      localStorage.setItem('codex-switch:token-usage-weeks', '2');
      window.__tokenMetrics = { entries: 0, daily: 0, breakdown: 0, quota: 0, renders: 0, draws: 0 };
      window.__tokenDelay = 40;
      window.__tokenCount = name => { window.__tokenMetrics[name]++; };
      window.__tokenProbe = async (name, load) => {
        window.__tokenCount(name);
        await new Promise(resolve => setTimeout(resolve, window.__tokenDelay));
        return load();
      };
    });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.token-dashboard-page')).toBeAttached();
    const report: Record<string, unknown> = { mode, observationMs, transport: 'preview with 40ms artificial read delay',
      sourceHashes: Object.fromEntries(['../../shared/token-usage/useWindowVisible.ts',
        '../../shared/token-usage/useDocumentVisible.ts',
        '../../shared/token-usage/queryCache.ts', 'src/components/TokenUsagePanel.tsx',
        'src/components/TokenUsageDashboard/useDashboardData.ts',
        'src/components/TokenUsageDashboard/dashboardQuery.ts'].map(path =>
        [path, createHash('sha256').update(readFileSync(path)).digest('hex')])) };
    report.unvisited = await observe(page);
    if (mode === 'after') expect(await counts(page)).toEqual({ entries: 0, daily: 0, breakdown: 0,
      quota: 0, renders: 0, draws: 0 });
    await page.getByRole('button', { name: /^Token/ }).first().click();
    await expect(page.locator('.token-dashboard-page')).toBeVisible();
    await expect(page.locator('.token-dashboard-page canvas').first()).toBeVisible();
    report.open = await observe(page);
    await page.screenshot({ path: `${directory}/${mode}-desktop-local-open-1440.png` });
    await page.getByRole('button', { name: /^(Accounts|账户管理)$/ }).click();
    await expect(page.locator('.token-dashboard-page')).toBeHidden();
    await page.waitForTimeout(200);
    report.hidden = await observe(page);
    if (mode === 'after') expect(report.hidden).toEqual({ entries: 0, daily: 0, breakdown: 0,
      quota: 0, renders: 0, draws: 0 });
    await page.screenshot({ path: `${directory}/${mode}-desktop-local-hidden-1440.png` });
    await page.getByRole('button', { name: /^Token/ }).first().click();
    await expect(page.locator('.token-dashboard-page canvas').first()).toBeVisible();
    report.reopened = await observe(page);
    await page.screenshot({ path: `${directory}/${mode}-desktop-local-reopened-1440.png` });
    const separate = await context.newPage();
    separate.on('pageerror', error => errors.push(error.message));
    await separate.route('https://fonts.googleapis.com/**', route => route.abort());
    await separate.route('https://fonts.gstatic.com/**', route => route.abort());
    await separate.goto('/#token-usage', { waitUntil: 'domcontentloaded' });
    await expect(separate.locator('canvas').first()).toBeVisible();
    await page.waitForTimeout(200);
    const mainBefore = await counts(page);
    const separateBefore = await counts(separate);
    await page.waitForTimeout(observationMs);
    report.both = { main: difference(await counts(page), mainBefore),
      independent: difference(await counts(separate), separateBefore) };
    report.browserServices = await separate.evaluate(() => ({ origin: location.origin,
      locks: !!navigator.locks, indexedDB: !!indexedDB, visibility: document.visibilityState }));
    await separate.screenshot({ path: `${directory}/${mode}-desktop-independent-open-1440.png` });
    await separate.close();
    await page.evaluate(() => { window.__tokenDelay = 3000; });
    await page.locator('.token-dashboard-page').getByRole('button', { name: /^(Refresh|刷新)$/ }).last().click();
    const started = Date.now();
    await page.getByRole('button', { name: /^(Accounts|账户管理)$/ }).click();
    await expect(page.locator('.token-dashboard-page')).toBeHidden();
    report.navigationDuringPendingReadMs = Date.now() - started;
    report.errors = errors;
    writeFileSync(`${directory}/${mode}.json`, JSON.stringify(report, null, 2));
    expect(errors).toEqual([]);
  });
