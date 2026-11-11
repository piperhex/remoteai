import { expect, test } from '@playwright/test';

for (const mode of ['local', 'remote', 'web']) {
  for (const appearance of ['light', 'dark-large']) {
    test(`${mode} ${appearance}: recovery actions, typography and failed task links`, async ({ page }, info) => {
      const requests: { operation: string; action?: string; entries?: unknown[] }[] = [];
      let decision = 'resume';
      await page.route('**/recovery-fixture', route => {
        const request = route.request().postDataJSON();
        requests.push(request);
        return route.fulfill({ json: request.operation === 'recoveryList'
          ? { batchId: 'restart', candidates: [{ title: '检查项目',
            entry: { threadId: 'recoverable', turnId: 'interrupted', observedAt: 1 } }] }
          : { failed: decision === 'resume' ? [{ threadId: 'recoverable', title: '检查项目' }] : [] } });
      });
      const large = appearance === 'dark-large';
      await page.setViewportSize({ width: large ? 900 : 1280, height: 800 });
      const origin = mode === 'web' ? 'http://127.0.0.1:1463/web/' : 'http://127.0.0.1:1462/';
      const url = `${origin}e2e/task-recovery-harness.html?mode=${mode}${large ? '&dark&large' : ''}`;
      await page.goto(url);
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('恢复 1 个任务？');
      await expect(page.getByRole('button', { name: '保持暂停' })).toBeFocused();
      await expect(dialog).toHaveCSS('width', '400px');
      const bodySize = mode === 'web' ? (large ? 20 : 14) : (large ? 16 : 12);
      await expect(dialog.locator('p')).toHaveCSS('font-size', `${bodySize}px`);
      await expect(dialog).toHaveCSS('animation-name', 'none');
      await expect(dialog).toHaveCSS('transform', 'none');
      await expect(dialog).toHaveCSS('opacity', '1');
      await page.evaluate(() => new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      // Allow the headless compositor to paint the completed modal entrance.
      await page.waitForTimeout(500);
      await page.screenshot({ path: info.outputPath(`${mode}-${appearance}.png`) });
      await page.getByRole('button', { name: '全部恢复' }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('alert')).toContainText('部分任务的恢复结果未能确认');
      await page.waitForTimeout(500);
      await page.screenshot({ path: info.outputPath(`${mode}-${appearance}-failure.png`) });
      await page.getByRole('button', { name: '检查项目', exact: true }).click();
      await expect(page.locator('output')).toHaveText('recoverable');
      expect(requests.filter(request => request.operation === 'recoveryDecide')).toEqual([
        { operation: 'recoveryDecide', batchId: 'restart', action: 'resume',
          entries: [{ threadId: 'recoverable', turnId: 'interrupted', observedAt: 1 }] },
      ]);
      decision = 'dismiss';
      await page.goto(url);
      await expect(dialog).toBeVisible();
      await page.getByRole('button', { name: '保持暂停' }).click();
      await expect(dialog).toBeHidden();
      expect(requests.at(-1)?.action).toBe('dismiss');
      await expect(page.getByRole('alert')).toHaveCount(0);
    });
  }
}
