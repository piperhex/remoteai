import { expect, test } from '@playwright/test';
import type {} from './mermaid-harness';

test('measures real layouts for the same fixed source increments and repeat', async ({ page }, info) => {
  await page.goto('/e2e/mermaid-harness.html?entry=local');
  const canvas = page.locator('.chat-mermaid-canvas');
  await expect(canvas).toContainText('提交问题');
  const before = await page.evaluate(() => window.mermaidFixture.stats());
  const elapsedMs = await page.evaluate(async () => {
    const start = performance.now();
    for (let index = 0; index < 40; index++) {
      window.mermaidFixture.update({ source: `flowchart LR\n A[步骤 ${index}] --> B[结果 ${index}]` });
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return performance.now() - start;
  });
  await expect(canvas).toContainText('结果 39');
  const streamed = await page.evaluate(() => window.mermaidFixture.stats());
  await page.evaluate(() => window.mermaidFixture.update({ session: 'repeated-conversation' }));
  await expect(canvas).toContainText('结果 39');
  const after = await page.evaluate(() => window.mermaidFixture.stats());
  const measurement = { baseline: process.env.MERMAID_BASELINE === '1', updates: 40, requestedIntervalMs: 20,
    elapsedInputMs: elapsedMs, requests: streamed.requests - before.requests,
    layouts: streamed.layouts - before.layouts, repeatLayouts: after.layouts - streamed.layouts,
    repeatCacheHits: after.cacheHits - streamed.cacheHits };
  if (!measurement.baseline) {
    expect(measurement.requests).toBe(1); expect(measurement.layouts).toBe(1);
    expect(measurement.repeatLayouts).toBe(0); expect(measurement.repeatCacheHits).toBe(1);
  }
  console.log('MERMAID_REAL_LAYOUT_COUNTS', JSON.stringify(measurement));
  await info.attach('real-layout-counts', { contentType: 'application/json', body: JSON.stringify(measurement, null, 2) });
});
