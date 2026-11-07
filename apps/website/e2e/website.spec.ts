import { expect, test, type Page } from '@playwright/test';
import { basePath } from '../scripts/site.config.mjs';

for (const appearance of ['dark', 'light']) {
  test(`every exported page hydrates and loads its images in ${appearance}`, async ({ page, request }) => {
    await page.addInitScript((value) => localStorage.setItem('remoteai-website-theme', value), appearance);
    const sitemap = await request.get(`${basePath}sitemap.xml`);
    const paths = [...(await sitemap.text()).matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => new URL(match[1]).pathname);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    for (const path of [...paths, `${basePath}404.html`]) {
      await page.goto(path);
      await expect(page.locator('h1')).toBeVisible();
      // Long pages can have images outside the browser's lazy-loading distance.
      await loadImages(page);
      await expect
        .poll(() =>
          page
            .locator('img')
            .evaluateAll((images) =>
              images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0),
            ),
        )
        .toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}

test('navigation, feature filters, language switch and FAQ work', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByText('探索功能').click();
  await expect(page.locator('.feature-catalog .feature-card')).toHaveCount(11);
  await page.getByRole('button', { name: '连接与操作', exact: true }).click();
  await expect(page.locator('.feature-catalog .feature-card')).toHaveCount(2);
  await page
    .getByRole('link', { name: /跨设备工作区/ })
    .first()
    .click();
  await expect(page.locator('h1')).toContainText('电脑上的工作');
  await page.locator('.language-switch summary').click();
  await expect(page.locator('.language-options')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.language-options')).toBeHidden();
  await page.locator('.language-switch summary').click();
  await page.locator('h1').click();
  await expect(page.locator('.language-options')).toBeHidden();
  await page.locator('.language-switch summary').click();
  await page.getByRole('link', { name: 'EN', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/features\/remote-workspace\/$/);
  await expect(page.locator('h1')).toContainText('Same computer');
  await page.getByText('Can tasks run after my computer shuts down?', { exact: true }).click();
  await expect(page.locator('details[open]')).toContainText('No. Tasks depend on the host computer.');
  await page.locator('.language-switch summary').click();
  await page.getByRole('link', { name: 'RU', exact: true }).click();
  await expect(page).toHaveURL(/\/ru\/features\/remote-workspace\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.locator('.language-options a[hreflang="en"]')).toHaveAttribute(
    'href',
    `${basePath}en/features/remote-workspace/`,
  );
  await page.locator('.language-switch summary').click();
  await page.getByRole('link', { name: '日本語', exact: true }).click();
  await expect(page).toHaveURL(/\/ja\/features\/remote-workspace\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.locator('h1')).toContainText('いつものコンピューターを');
  await page.locator('.language-switch summary').click();
  await page.getByRole('link', { name: '中文', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${basePath}features/remote-workspace/$`));
  await expect(page.locator('h1')).toContainText('电脑上的工作');
});

test('narrow screens keep navigation and long feature pages usable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of [
    '',
    'features/',
    'features/providers/',
    'features/remote-workspace/',
    'features/computer-use/',
    'download/',
    'guide/',
    'resources/',
    'en/',
    'en/resources/',
    'en/features/computer-use/',
    'ru/',
    'ru/resources/',
    'ru/features/computer-use/',
    'ja/',
    'ja/resources/',
    'ja/features/computer-use/',
  ]) {
    await page.goto(`${basePath}${path}`);
    await expect(page.locator('h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
  }
  await page.goto('./');
  await page.getByLabel('打开导航', { exact: true }).click();
  await page.getByRole('navigation', { name: '移动导航' }).getByText('使用指南').click();
  await expect(page).toHaveURL(/\/guide\/$/);
});

test('core content, FAQ and mobile navigation remain usable without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false,
    viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('features/codex-gui/');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.getByRole('heading', { name: '把上下文交代清楚，再开始' })).toBeVisible();
  await page.getByText('一定要先选择项目吗？', { exact: true }).click();
  await expect(page.locator('details[open]')).toContainText('不需要');
  await page.getByLabel('打开导航', { exact: true }).click();
  await page.getByRole('navigation', { name: '移动导航' }).getByText('下载', { exact: true }).click();
  await expect(page.locator('h1')).toContainText('你的下一段工作');
  await page.locator('.site-footer').getByRole('link', { name: 'AI 资源', exact: true }).click();
  await expect(page.locator('.resource-card')).toHaveCount(26);
  await page.getByRole('navigation', { name: '按需探索' }).getByRole('link', { name: /评测与学习/ }).click();
  await expect(page).toHaveURL(/\/resources\/#learn$/);
  await expect(page.getByRole('heading', { name: '评测与学习 4', exact: true })).toBeInViewport();
  await page.goto('ru/');
  await page.locator('.site-footer').getByRole('link', { name: 'ИИ-ресурсы', exact: true }).click();
  await expect(page).toHaveURL(/\/ru\/resources\/$/);
  await expect(page.locator('.resource-card')).toHaveCount(26);
  await expect(page.locator('.resource-stats')).toContainText('Разделов: 5');
  await page
    .getByRole('navigation', { name: 'Обзор по разделам' })
    .getByRole('link', { name: /Оценка моделей/ })
    .click();
  await expect(page).toHaveURL(/\/ru\/resources\/#learn$/);
  await expect(page.getByRole('heading', { name: 'Оценка моделей и обучение 4', exact: true })).toBeInViewport();
  await page.goto('ja/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.locator('h1')).toContainText('アイデアを');
  await page.goto('ja/resources/');
  await expect(page.locator('.resource-card')).toHaveCount(26);
  await context.close();
});

test('capture desktop and mobile visual checkpoints', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: '切换深色主题', exact: true }).click();
  await loadImages(page);
  await page.screenshot({ path: 'test-results/home-desktop-viewport.png' });
  await page.screenshot({ path: 'test-results/home-desktop.png', fullPage: true });
  await page.goto('features/codex-gui/');
  await loadImages(page);
  await page.screenshot({ path: 'test-results/feature-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await loadImages(page);
  await page.screenshot({ path: 'test-results/home-mobile-viewport.png' });
  await page.screenshot({ path: 'test-results/home-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '切换纯白主题', exact: true }).click();
  await page.screenshot({ path: 'test-results/home-white-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loadImages(page);
  await page.screenshot({ path: 'test-results/home-white-desktop-viewport.png' });
  await page.screenshot({ path: 'test-results/home-white-desktop.png', fullPage: true });
  await page.goto('features/remote-workspace/');
  await page.screenshot({ path: 'test-results/feature-white-desktop.png', fullPage: true });
  await page.goto('ja/');
  await loadImages(page);
  await page.screenshot({ path: 'test-results/home-japanese-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/home-japanese-mobile.png' });
});

async function loadImages(page: Page) {
  // Resizing can replace a srcset candidate while decode() is pending. Require a successful
  // decode after the selected source settles; genuinely broken images still fail this check.
  await expect.poll(() => page.locator('img').evaluateAll(async (images) => {
    const failures = await Promise.all(images.map(async (image) => {
      if (!(image instanceof HTMLImageElement)) return null;
      image.loading = 'eager';
      try { await image.decode(); return null; }
      catch { return image.currentSrc || image.src; }
    }));
    return failures.filter(source => source !== null);
  })).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
