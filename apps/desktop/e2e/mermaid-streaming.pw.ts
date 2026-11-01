import { expect, test, type Page } from '@playwright/test';
import type {} from './mermaid-harness';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => console.error('Mermaid fixture page error:', error.message));
  page.on('requestfailed', request => console.error('Mermaid fixture request failed:', request.url()));
  page.on('console', message => {
    if (message.type() === 'error') console.error('Mermaid fixture console:', message.text());
  });
});

async function referenceErrors(page: Page) {
  return page.locator('.chat-mermaid-canvas').evaluateAll(canvases => {
    const errors: string[] = [];
    const allIds = canvases.flatMap(canvas => Array.from(canvas.querySelectorAll('[id]'), node => node.id));
    if (new Set(allIds).size !== allIds.length) errors.push('duplicate IDs');
    for (const canvas of canvases) {
      const ids = new Set(Array.from(canvas.querySelectorAll('[id]'), node => node.id));
      const urls = [...canvas.innerHTML.matchAll(/url\(["']?(?:[^#)]*)#([^)'"\s]+)["']?\)/g)];
      for (const [, id] of urls) if (!ids.has(id)) errors.push(`unresolved url #${id}`);
      for (const element of Array.from(canvas.querySelectorAll('[href], [aria-labelledby], [aria-describedby]'))) {
        const href = element.getAttribute('href');
        if (href?.startsWith('#') && !ids.has(href.slice(1))) errors.push(`unresolved href ${href}`);
        const aria = `${element.getAttribute('aria-labelledby') ?? ''} ${element.getAttribute('aria-describedby') ?? ''}`;
        for (const id of aria.trim().split(/\s+/)) if (id && !ids.has(id)) errors.push(`unresolved aria ${id}`);
      }
    }
    return errors;
  });
}

for (const entry of ['local', 'remote', 'web', 'web-mobile']) {
  test(`${entry}: coalesces increments, caches duplicates and isolates themes/sessions`, async ({ page }, info) => {
    if (entry === 'web-mobile') await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/e2e/mermaid-harness.html?entry=${entry}`);
    const diagrams = page.locator('.chat-mermaid-diagram');
    await expect(diagrams.locator('.chat-mermaid-canvas')).toContainText('提交问题');
    const before = await page.evaluate(() => window.mermaidFixture.stats());
    const final = await page.evaluate(async () => {
      let source = 'flowchart LR\n A[开始] --> B[完成]';
      for (let index = 0; index < 40; index++) {
        source = `flowchart LR\n A[步骤 ${index}] --> B[最终结果 ${index}]`;
        window.mermaidFixture.update({ source });
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return source;
    });
    await expect(diagrams.locator('.chat-mermaid-canvas')).toContainText('最终结果 39');
    const streamed = await page.evaluate(() => window.mermaidFixture.stats());
    expect(streamed.requests - before.requests).toBe(1);
    expect(streamed.layouts - before.layouts).toBe(1);
    await page.evaluate(() => window.mermaidFixture.update({ duplicate: true }));
    await expect(diagrams.locator('.chat-mermaid-canvas')).toHaveCount(2);
    const repeated = await page.evaluate(() => window.mermaidFixture.stats());
    expect(repeated.layouts).toBe(streamed.layouts);
    expect(repeated.cacheHits - streamed.cacheHits).toBe(1);
    expect(await referenceErrors(page)).toEqual([]);
    await page.screenshot({ path: info.outputPath(`${entry}-light-repeated-final.png`) });
    await page.getByRole('button', { name: 'Theme', exact: true }).click();
    await expect(diagrams.locator('.chat-mermaid-canvas')).toHaveCount(2);
    await expect.poll(() => page.evaluate(() => window.mermaidFixture.stats().layouts)).toBe(repeated.layouts + 1);
    const darkInk = await diagrams.first().locator('.nodeLabel').first().evaluate(node => getComputedStyle(node).fill);
    expect(darkInk).toBe('rgb(230, 232, 235)');
    expect(await referenceErrors(page)).toEqual([]);
    await page.screenshot({ path: info.outputPath(`${entry}-dark-repeated-final.png`) });
    await page.getByRole('button', { name: 'Theme', exact: true }).click();
    await expect(diagrams.locator('.chat-mermaid-canvas')).toHaveCount(2);
    const restored = await page.evaluate(() => window.mermaidFixture.stats());
    expect(restored.layouts).toBe(repeated.layouts + 1);
    await page.evaluate(() => {
      window.mermaidFixture.update({ source: 'flowchart LR\n Pending[old]', duplicate: false });
      window.mermaidFixture.update({ visible: false });
    });
    await expect(diagrams).toHaveCount(0);
    await page.waitForTimeout(250);
    expect((await page.evaluate(() => window.mermaidFixture.stats())).layouts).toBe(restored.layouts);
    await page.evaluate(source => window.mermaidFixture.update({ source, session: 'next', visible: true }), final);
    await expect(diagrams.locator('.chat-mermaid-canvas')).toContainText('最终结果 39');
    expect((await page.evaluate(() => window.mermaidFixture.stats())).layouts).toBe(restored.layouts);
    await page.evaluate(() => window.mermaidFixture.update({ source: 'flowchart TD\n A[' }));
    await expect(diagrams).toHaveAttribute('aria-busy', 'false');
    await expect(diagrams.locator('code')).toHaveText('flowchart TD\n A[');
    await page.screenshot({ path: info.outputPath(`${entry}-incomplete-final-fallback.png`) });
    await page.evaluate(source => window.mermaidFixture.update({ source }), final);
    await expect(diagrams.locator('.chat-mermaid-canvas')).toContainText('最终结果 39');
    await expect(page.locator('[data-mermaid-render]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const after = await page.evaluate(() => window.mermaidFixture.stats());
    await info.attach('mermaid-counts', { contentType: 'application/json',
      body: JSON.stringify({ entry, updates: 40, intervalMs: 20, before, streamed, repeated, restored, after }, null, 2) });
  });
}
