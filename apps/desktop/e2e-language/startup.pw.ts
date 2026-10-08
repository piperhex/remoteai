import { expect, test } from '@playwright/test';

const applications = [
  { name: 'desktop', url: 'http://127.0.0.1:1486/', key: 'codex-switch:language',
    viewport: { width: 1440, height: 1000 } },
  { name: 'web-wide', url: 'http://127.0.0.1:1487/web/', key: 'codex-switch.web.language.v1',
    viewport: { width: 1440, height: 1000 } },
  { name: 'web-narrow', url: 'http://127.0.0.1:1487/web/', key: 'codex-switch.web.language.v1',
    viewport: { width: 320, height: 740 } },
];

test.describe('Linux message locale', () => {
  test.use({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
  test('uses the locale supplied before rendering and preserves a saved choice', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(globalThis, '__REMOTE_AI_SYSTEM_LOCALE__', { value: 'zh_CN.UTF-8' });
    });
    await page.goto(applications[0].url);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByRole('button', { name: '设置', exact: true }).first()).toBeVisible();
    await page.evaluate(key => localStorage.setItem(key, 'en'), applications[0].key);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
    await expect(page.getByRole('button', { name: 'Settings', exact: true }).first()).toBeVisible();
  });
});

for (const app of applications) {
  for (const locale of ['en-US', 'zh-CN', 'fr-FR', 'ru-RU']) {
    test.describe(`${app.name} ${locale}`, () => {
      test.use({ locale, viewport: app.viewport });
      test('first launch follows the locale and saved preferences take priority', async ({ page }, info) => {
        const chinese = locale === 'zh-CN';
        await page.goto(app.url);
        await expect(page.locator('html')).toHaveAttribute('lang', chinese ? 'zh-CN' : 'en-US');
        const label = app.name === 'desktop' ? (chinese ? '设置' : 'Settings') : (chinese ? '邮箱' : 'Email');
        const role = app.name === 'desktop' ? 'button' : 'textbox';
        await expect(page.getByRole(role, { name: label, exact: true }).first()).toBeVisible();
        if (!chinese) expect(await page.locator('body').innerText()).not.toMatch(/[\u4e00-\u9fff]/);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath('first-launch.png') });
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('lang', chinese ? 'zh-CN' : 'en-US');
        for (const [choice, htmlLang] of [['ru', 'ru-RU'], ['zh', 'zh-CN'], ['en', 'en-US']]) {
          await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: app.key, value: choice });
          await page.reload();
          await expect(page.locator('html')).toHaveAttribute('lang', htmlLang);
        }
      });
    });
  }
}
