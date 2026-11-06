import { expect, type Page, type TestInfo } from '@playwright/test';

export async function verifyBrowserLoading(page: Page, info: TestInfo, label: string) {
  let slow = true;
  const waiting: (() => void)[] = [];
  await page.route('**/preview-site/**', route => route.fulfill({ contentType: 'text/html', body:
    '<body style="font:16px system-ui;padding:30px"><h1>Browser preview</h1>'
    + '<p>Remote AI</p><img src="/preview-loading-image" alt=""></body>',
  }));
  await page.route('**/preview-loading-image', async route => {
    if (slow) await new Promise<void>(resolve => waiting.push(resolve));
    await route.abort().catch(() => {});
  });
  const browser = page.locator('.website-preview-browser');
  const reload = browser.getByRole('button', { name: '刷新', exact: true });
  const stop = browser.getByRole('button', { name: '取消', exact: true });
  try {
    await page.getByRole('link', { name: '使用指南' }).click();
    await expect(browser.frameLocator('iframe').getByRole('heading', { name: 'Browser preview' })).toBeVisible();
    await expect(stop.locator('.lucide-x')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${label}-loading.png`) });
    await browser.getByRole('button', { name: '新标签页', exact: true }).click();
    await expect(reload).toBeDisabled();
    await browser.getByRole('tab').first().click();
    await expect(stop).toBeVisible();
    await stop.click();
    await expect(reload.locator('.lucide-rotate-cw')).toBeVisible();
    await expect(browser.locator('iframe').first().contentFrame().getByRole('heading')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${label}-stopped.png`) });
    slow = false; waiting.splice(0).forEach(release => release());
    await reload.click();
    await expect(browser.locator('iframe').first().contentFrame().getByRole('heading')).toBeVisible();
    await expect(reload).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${label}-loaded.png`) });
    slow = true;
    const address = browser.getByRole('textbox', { name: '页面地址', exact: true });
    await address.fill('https://preview.example.test/preview-site/cross-origin'); await address.press('Enter');
    await expect(stop).toBeVisible();
    await expect(browser.locator('iframe').first().contentFrame().getByRole('heading')).toBeVisible();
    await stop.click();
    await expect(reload).toBeVisible();
    await expect(address).toHaveValue('https://preview.example.test/preview-site/cross-origin');
    await expect(browser.locator('iframe').first()).toHaveAttribute('src', 'about:blank');
    await page.screenshot({ path: info.outputPath(`${label}-cross-origin-stopped.png`) });
  } finally {
    slow = false; waiting.splice(0).forEach(release => release());
  }
}
