import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve('../../.codex-tmp/thread-activity');
const recent = ['最后活跃 10:30', '较早创建 · 最后活跃 10:25', '最后活跃 10:20',
  '最后活跃 10:15', '最后活跃 10:10', '最后活跃 10:00'];

for (const [mode, width] of [['local', 1280], ['local', 900], ['remote', 1280], ['remote', 900]] as const) {
  test(`${mode} ${width}: activity ordering, live priority, folding and custom groups`, async ({ page }) => {
    await mkdir(output, { recursive: true });
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/e2e/thread-activity-harness.html?mode=${mode}`);
    const rows = page.locator(mode === 'local' ? '[class*="threadTitle"]' : '.chat-thread > .chat-grow');
    await expect(rows).toHaveText(['较早的对话 · 正在进行', ...recent.slice(0, 4)]);
    await page.screenshot({ path: path.join(output, `${mode}-${width}-light-running.png`) });
    await page.getByRole('button', { name: /展开显示/ }).click();
    await expect(rows).toHaveText(['较早的对话 · 正在进行', ...recent]);
    await page.screenshot({ path: path.join(output, `${mode}-${width}-light-expanded.png`) });
    await page.evaluate(() => (window as unknown as { activityFixture: { complete(): void } }).activityFixture.complete());
    await expect(rows).toHaveText(['刚刚完成的对话', ...recent]);
    await page.screenshot({ path: path.join(output, `${mode}-${width}-light-completed.png`) });
    await page.evaluate(() => (window as unknown as { activityFixture: { custom(): void } }).activityFixture.custom());
    await expect(rows).toHaveText(['刚刚完成的对话', ...recent.slice(0, 4)]);
    await page.getByRole('button', { name: /展开显示/ }).click();
    await expect(rows).toHaveText(['刚刚完成的对话', ...recent]);
    await page.screenshot({ path: path.join(output, `${mode}-${width}-light-custom-group.png`) });
  });
}
