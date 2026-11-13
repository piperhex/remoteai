import { expect, test } from '@playwright/test';

for (const dark of [false, true]) test(`mobile web tools reopen: ${dark ? 'dark large' : 'light'}`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(font => localStorage.setItem('codex-switch:global-font-size', String(font)), dark ? 20 : 14);
  await page.goto(`/e2e/workspace-drawer-harness.html?mode=web&toolLifecycle${dark ? '&dark' : ''}`);
  await expect.poll(() => page.locator('html').evaluate(element =>
    Number(getComputedStyle(element).getPropertyValue('--app-font-scale')))).toBeCloseTo(dark ? 20 / 14 : 1);
  const tools = [
    { name: '文件浏览', marker: page.getByRole('treeitem', { name: 'README.md', exact: true }),
      close: '[aria-label="关闭详情抽屉"]' },
    { name: 'Git', marker: page.getByRole('button', { name: '查看 src/app.ts', exact: true }),
      close: '[aria-label="关闭 Git"]' },
    { name: '终端', marker: page.locator('.xterm'), close: '[aria-label="收起终端"]' },
    { name: '远程桌面', marker: page.locator('.rd-status'), close: '.rd-toolbar button:has-text("关闭")' },
  ];
  for (const [index, tool] of tools.entries()) {
    for (let cycle = 0; cycle < 3; cycle++) {
      await page.getByRole('button', { name: '打开工具', exact: true }).click();
      await page.locator('.chat-tools-menu').getByRole('button', { name: tool.name, exact: true }).click();
      await expect(page.locator('.chat-tools-menu')).toBeHidden();
      await expect(tool.marker).toBeVisible();
      if (cycle === 2) await page.screenshot({ animations: 'disabled', path:
        `../../.codex-tmp/command-detail-gesture/web-tools-${dark ? 'dark-large' : 'light'}-${index}-reopened.png` });
      await page.locator(tool.close).filter({ visible: true }).last().click({ timeout: 10_000 });
      await expect(tool.marker).toBeHidden();
    }
  }
});
