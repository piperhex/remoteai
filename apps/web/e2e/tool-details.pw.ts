import { expect, test } from '@playwright/test';
import reported from '../../../shared/chat/toolDetailsFixture.json' with { type: 'json' };

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});

test('shows structured data immediately and copies the complete raw result at the bottom', async ({ page, context }, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('e2e/tool-details-harness.html');
  const content = page.locator('.chat-code-block');
  await expect(content).toHaveCount(1);
  await expect(content).toContainText('"elements": 100');
  await expect(page.locator('.chat-tool-markdown')).toHaveCount(0);
  const copy = page.getByRole('button', { name: '复制原始数据', exact: true });
  await expect(copy).toHaveCount(1);
  const contentBounds = (await content.boundingBox())!;
  const copyBounds = (await copy.boundingBox())!;
  expect(copyBounds.y).toBeGreaterThanOrEqual(contentBounds.y + contentBounds.height);
  expect(await content.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await copy.click();
  await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n')))
    .toBe(JSON.stringify(reported.result, null, 2));
  await expect(page.locator('.adm-toast-main')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('structured-result.png'), animations: 'disabled' });
  await page.getByText('查看输入', { exact: true }).click();
  await expect(page.locator('details').first()).toContainText('"pid": 4296');
  await page.getByRole('button', { name: '返回上一层' }).click();
  await expect(content).toHaveCount(0);
});

test('keeps literal output and full-copy behavior while paging', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('e2e/tool-details-harness.html');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: 'literal', exact: true }).click();
  await expect(page.locator('.chat-code-block').last()).toContainText('<div>literal output</div>');
  await expect(page.locator('.chat-code-block').last()).toContainText('**keep these characters**');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: 'long', exact: true }).click();
  await page.getByRole('button', { name: '下一段', exact: true }).click();
  await expect(page.locator('.chat-tool-markdown')).toContainText('OUTPUT_END');
  await page.getByRole('button', { name: '复制完整内容' }).click();
  const copied = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
  expect(copied.length).toBeGreaterThan(8_000);
  expect(copied).toMatch(/^Tool output line\.\n/);
  expect(copied).toMatch(/OUTPUT_END$/);
  await page.getByRole('button', { name: '上一段', exact: true }).click();
  await expect(page.getByRole('button', { name: '上一段', exact: true })).toBeDisabled();
});

test('keeps structured data readable with enlarged fonts and changes copy language offline', async ({ page }, info) => {
  await page.goto('e2e/tool-details-harness.html?font=20&theme=dark');
  const block = page.locator('.chat-code-block');
  await expect(block).toContainText('"elements": 100');
  await expect(page.getByRole('button', { name: '复制原始数据', exact: true })).toBeVisible();
  expect(await block.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('structured-dark-font-20.png'), animations: 'disabled' });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'reported', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy raw data', exact: true })).toBeVisible();
  await expect(block).toContainText('Structured result');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await page.getByRole('button', { name: 'reported', exact: true }).click();
  await expect(page.getByRole('button', { name: '复制原始数据', exact: true })).toBeVisible();
});
