import { expect, test } from '@playwright/test';

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: Enter submits once, Shift+Enter wraps, and IME confirmation stays in the input`, async ({ page }) => {
    const replies: string[][] = [];
    let release: (() => void) | undefined;
    await page.route('**/question-answer', async route => {
      replies.push(route.request().postDataJSON());
      if (replies.length === 1) await new Promise<void>(resolve => { release = resolve; });
      await route.fulfill({ status: replies.length === 1 ? 500 : 200, body: '{}' });
    });
    await page.goto(`/e2e/question-dialog-harness.html?mode=${mode}`);
    const answer = page.getByRole('textbox');
    await answer.press('Enter');
    expect(replies).toHaveLength(0);
    await answer.fill('ZH2');
    await answer.press('Shift+Enter');
    await expect(answer).toHaveValue('ZH2\n');
    for (const properties of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }]) {
      await answer.dispatchEvent('keydown', { key: 'Enter', ...properties });
    }
    expect(replies).toHaveLength(0);
    await answer.press('Enter');
    await expect.poll(() => replies.length).toBe(1);
    await expect(answer).toBeDisabled();
    await answer.dispatchEvent('keydown', { key: 'Enter' });
    expect(replies).toHaveLength(1);
    release?.();
    await expect(answer).toBeEnabled();
    await expect(answer).toHaveValue('ZH2\n');
    await expect(page.getByRole('alert')).toBeVisible();
    await answer.fill('ZH2，你可以直接操作，我已经打开窗口');
    await answer.press('Enter');
    await expect(answer).toHaveCount(0);
    expect(replies).toEqual([['ZH2\n'], ['ZH2，你可以直接操作，我已经打开窗口']]);
  });

  for (const appearance of [{ name: 'default', size: 14, width: 1280 },
    { name: 'enlarged-narrow-dark', size: 20, width: mode === 'web' ? 900 : 800, dark: true }]) {
    test(`${mode}: ${appearance.name} layout`, async ({ page }, info) => {
      await page.setViewportSize({ width: appearance.width, height: 900 });
      await page.addInitScript(size => {
        localStorage.setItem('codex-switch:global-font-size', String(size));
      }, appearance.size);
      await page.goto(`/e2e/question-dialog-harness.html?mode=${mode}&options&multi${appearance.dark ? '&dark' : ''}`);
      const content = page.getByRole('region', { name: '问题', exact: true });
      await expect(page.getByRole('radio', { name: /ZH2/ })).toBeChecked();
      await page.getByRole('textbox').fill('ZH2，你可以直接操作，我已经打开窗口');
      const overflow = await content.evaluate(element => element.scrollWidth > element.clientWidth);
      expect(overflow).toBe(false);
      await expect(page.getByRole('textbox')).toHaveCSS('font-size', `${appearance.size}px`);
      await expect(content).toHaveCSS('font-size', `${appearance.size}px`);
      const path = info.outputPath(`${mode}-${appearance.name}.png`);
      await content.screenshot({ path, animations: 'disabled' });
      await info.attach(`${mode}-${appearance.name}`, { path, contentType: 'image/png' });
      await content.getByRole('navigation').getByRole('button', { name: '下一题' }).click();
      await expect(content.getByText('2 / 2')).toBeVisible();
      await content.screenshot({ path: info.outputPath(`${mode}-${appearance.name}-page2.png`),
        animations: 'disabled' });
    });
  }
}
