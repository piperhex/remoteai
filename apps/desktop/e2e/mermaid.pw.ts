import { expect, test, type Locator, type Page } from '@playwright/test';

async function assertNoTemporarySvg(page: Page) {
  await expect(page.locator('[data-mermaid-render], body > div[id^="dmermaid-"], body > iframe[id^="imermaid-"]'))
    .toHaveCount(0);
}

test('cleans errors even when diagram directives enable error rendering', async ({ page }) => {
  await page.goto('/e2e/mermaid-harness.html?entry=local');
  await expect(page.locator('.chat-mermaid-canvas > svg')).toContainText('提交问题');
  await page.getByRole('button', { name: 'Invalid directive', exact: true }).click();
  await expect(page.locator('.chat-mermaid-source')).toContainText('suppressErrorRendering');
  await expect(page.locator('.chat-mermaid-diagram')).toHaveAttribute('aria-busy', 'false');
  await assertNoTemporarySvg(page);
  await page.getByRole('button', { name: 'Flow', exact: true }).click();
  await page.getByRole('button', { name: 'Mount', exact: true }).click();
  await expect(page.locator('.chat-mermaid-diagram')).toHaveCount(0);
  await assertNoTemporarySvg(page);
});

async function colors(diagram: Locator) {
  return diagram.evaluate(element => {
    const svg = element.querySelector('.chat-mermaid-canvas > svg');
    const text = svg?.querySelector('.messageText, .nodeLabel');
    return { background: getComputedStyle(element).backgroundColor,
      ink: text ? getComputedStyle(text).fill : '', svg: svg?.innerHTML ?? '' };
  });
}

for (const entry of ['local', 'remote', 'web']) {
  test(`${entry}: previews, source, live theme changes and invalid streamed blocks`, async ({ page }, info) => {
    await page.goto(`/e2e/mermaid-harness.html?entry=${entry}`);
    const diagram = page.locator('.chat-mermaid-diagram');
    await expect(diagram.locator('.chat-mermaid-canvas > svg')).toContainText('提交问题');
    const light = await colors(diagram);
    await diagram.screenshot({ path: info.outputPath(`${entry}-light-flow.png`) });
    await page.getByRole('button', { name: 'Theme', exact: true }).click();
    await expect.poll(async () => {
      const current = await colors(diagram);
      return Boolean(current.svg && current.svg !== light.svg);
    }).toBe(true);
    await expect.poll(async () => (await colors(diagram)).background).not.toBe(light.background);
    await page.getByRole('button', { name: 'Sequence', exact: true }).click();
    await expect(diagram.locator('.chat-mermaid-canvas > svg')).toContainText('发送消息');
    const dark = await colors(diagram);
    expect(dark.background).not.toMatch(/rgba?\(255, 255, 255/);
    expect(dark.ink).toBe('rgb(230, 232, 235)');
    await diagram.screenshot({ path: info.outputPath(`${entry}-dark-sequence.png`) });
    await diagram.getByRole('button', { name: '原文', exact: true }).click();
    await expect(diagram.locator('code')).toContainText('sequenceDiagram');
    await diagram.screenshot({ path: info.outputPath(`${entry}-dark-source.png`) });
    await diagram.getByRole('button', { name: '预览', exact: true }).click();
    await page.getByRole('button', { name: 'Invalid', exact: true }).click();
    await expect(diagram.locator('code')).toHaveText('flowchart TD\n A[');
    await expect(diagram).toHaveAttribute('aria-busy', 'false');
    await expect(diagram.getByRole('button', { name: '原文', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await assertNoTemporarySvg(page);
    await page.screenshot({ path: info.outputPath(`${entry}-invalid-fallback.png`) });
    await page.getByRole('button', { name: 'Mount', exact: true }).click();
    await expect(diagram).toHaveCount(0);
    await assertNoTemporarySvg(page);
    await page.getByRole('button', { name: 'Flow', exact: true }).click();
    await page.getByRole('button', { name: 'Mount', exact: true }).click();
    await expect(diagram.locator('.chat-mermaid-canvas > svg')).toContainText('提交问题');
    await page.getByRole('button', { name: 'Multiple', exact: true }).click();
    await expect(diagram.locator('.chat-mermaid-canvas > svg')).toHaveCount(2);
    await page.getByRole('button', { name: 'Theme', exact: true }).click();
    await expect.poll(async () => (await colors(diagram.last())).ink).toBe('rgb(23, 37, 31)');
    await assertNoTemporarySvg(page);
    await page.setViewportSize({ width: entry === 'web' ? 390 : 860, height: 700 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${entry}-narrow-light.png`) });
  });
}
