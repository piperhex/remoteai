import { expect, test, type Locator } from '@playwright/test';
import type { Thread } from '../src/chat/types';

function commandThread(output: string): Thread {
  return { id: 'virtual-output', cwd: '', preview: '', updatedAt: 1,
    turns: [{ id: 'turn', status: 'completed', items: [{ id: 'command', type: 'commandExecution',
      status: 'completed', command: 'check-output', aggregatedOutput: output, exitCode: 0 }] }] };
}

async function scrollToEnd(viewport: Locator, expected: string) {
  await expect.poll(async () => {
    await viewport.evaluate(node => { node.scrollTop = node.scrollHeight; });
    return viewport.innerText();
  }).toContain(expected);
}

test('mobile command output scrolls beyond the former page boundary', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'mobile');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const output = Array.from({ length: 3_000 }, (_, i) => `LINE_${i} 检查记录 🙂 packages/scripts/output.log`).join('\n')
    + '\nOUTPUT_END';
  const value = commandThread(output);
  await page.route('**/display-fixture.json', route => route.fulfill({ json: value }));
  await page.goto('e2e/chat-display-harness.html');
  await page.getByRole('button', { name: '查看处理过程，1 项活动' }).click();
  const sheet = page.locator('.chat-work-drawer');
  await expect(sheet.locator('.chat-virtual-command-viewport')).toHaveCount(0);
  const toggle = sheet.getByRole('button', { name: /执行命令.*check-output/ });
  await toggle.click();
  const viewport = sheet.locator('.chat-virtual-command-viewport').last();
  await expect(viewport).toContainText('LINE_0 ');
  await expect(sheet.getByText('内容较长，分段显示')).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: /上一段|下一段/ })).toHaveCount(0);
  expect(await viewport.locator('pre').count()).toBeLessThan(8);
  await page.screenshot({ path: info.outputPath('mobile-light-output-start.png') });
  await viewport.evaluate(node => { node.scrollTop = 18_000; });
  await expect.poll(async () => Number(await viewport.locator('pre').first().getAttribute('data-text-start')))
    .toBeGreaterThan(8_000);
  await expect(viewport).not.toContainText('LINE_0 ');
  expect(await viewport.locator('pre').count()).toBeLessThan(8);
  await page.screenshot({ path: info.outputPath('mobile-light-output-scrolled.png') });
  await scrollToEnd(viewport, 'OUTPUT_END');
  await sheet.getByRole('button', { name: '复制输出', exact: true }).click();
  // The Windows clipboard normalizes line endings to CRLF.
  await expect.poll(async () => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'))
    .toBe(output);
  value.turns![0].items[0].aggregatedOutput += '\nAPPENDED_OUTPUT';
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent('display-fixture', { detail })), value);
  await scrollToEnd(viewport, 'APPENDED_OUTPUT');
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(async () => {
    const modulePath = '/web/src/theme/preference.ts';
    (await import(modulePath)).setThemeMode('dark');
    document.documentElement.style.setProperty('--app-font-scale', '1.3');
  });
  await viewport.evaluate(node => { node.scrollTop = 0; });
  await expect(viewport).toContainText('LINE_0 ');
  await expect(viewport).not.toContainText('OUTPUT_END');
  await page.screenshot({ path: info.outputPath('mobile-dark-320-large-font-output.png') });
  await toggle.click();
  await expect(sheet.locator('.chat-virtual-command-viewport')).toHaveCount(0);
});
