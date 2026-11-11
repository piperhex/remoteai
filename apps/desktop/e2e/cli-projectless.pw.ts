import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { localBackend, nativeShell } from './cli-gui-support';
import type { createCliGuiFixture } from './cli-gui-fixture';

const evidence = resolve('../../.codex-tmp/cli-projectless-evidence');
const labels = {
  zh: ['计划模式', '始终询问', '自动批准文件编辑', '自动审核', '跳过权限确认'],
  en: ['Plan mode', 'Always ask', 'Auto-approve file edits', 'Auto-review', 'Skip permission prompts'],
  ja: ['プランモード', '常に確認', 'ファイル編集を自動承認', '自動レビュー', '権限の確認をスキップ'],
  ru: ['Режим планирования', 'Всегда спрашивать', 'Автоматически разрешать правки файлов',
    'Автоматическая проверка', 'Не запрашивать разрешения'],
};
type FixtureWindow = Window & { cliFixture: ReturnType<typeof createCliGuiFixture>;
  setCliLanguage: (language: string) => void };

for (const mode of ['local', 'remote', 'web']) {
  for (const engine of ['claude', 'gemini'] as const) {
    for (const large of [false, true]) {
      test(`${mode}: ${engine} projectless chat and live permissions ${large ? 'dark large' : 'default'}`, async ({ page }) => {
        const variant = large ? 'dark-large' : 'light-default';
        await mkdir(evidence, { recursive: true });
        await page.setViewportSize({ width: large ? 960 : 1100, height: 900 });
        if (mode === 'local') await nativeShell(page);
        const fixture = await localBackend(page);
        await page.goto(`/e2e/cli-gui-harness.html?mode=${mode}&native${large ? '&large&dark' : ''}`);
        await page.locator('.cli-gui-engine:visible').click();
        await page.getByRole('menuitem', { name: engine === 'claude' ? 'Claude GUI' : 'Gemini GUI', exact: true }).click();
        const pane = page.locator('.cli-gui-pane');
        const access = pane.locator('button[aria-haspopup="menu"]').filter({ has: page.locator('svg.lucide-shield-check') });
        await expect(access).toBeEnabled();
        await access.click();
        for (const [language, names] of Object.entries(labels)) {
          await page.evaluate(value => (window as FixtureWindow).setCliLanguage(value), language);
          const plan = page.getByRole('menuitemradio', { name: names[0], exact: true });
          await expect(plan).toBeVisible();
          if (engine === 'claude') await expect(page.getByRole('menuitemradio')).toHaveText(names);
          else for (const name of [names[0], names[2], names[4]]) {
            await expect(page.getByRole('menuitemradio', { name, exact: true })).toBeVisible();
          }
          await expect(page.locator('.ant-popover:visible')).toHaveCSS('opacity', '1');
          if (mode === 'remote') {
            const textColor = await page.locator('.ant-popover-inner:visible')
              .evaluate(node => getComputedStyle(node).color);
            await expect(page.getByRole('menuitemradio').first()).toHaveCSS('color', textColor);
          }
          await page.screenshot({ path: resolve(evidence, `${mode}-${engine}-${variant}-${language}-modes.png`),
            animations: 'disabled' });
        }
        await page.evaluate(() => (window as FixtureWindow).setCliLanguage('zh'));
        await page.getByRole('menuitemradio', { name: '计划模式', exact: true }).click();
        await expect(access).toContainText('计划模式');
        const input = pane.getByRole('textbox', { name: '消息', exact: true });
        await input.fill('你好，介绍一下你能做什么。');
        const send = pane.getByRole('button', { name: '发送消息', exact: true });
        await expect(send).toBeEnabled();
        await send.click();
        await expect(page.getByText('已经检查现有代码。需要确认后才能更新项目文件。')).toBeVisible();
        await expect(pane.getByRole('alert')).toHaveCount(0);
        await page.screenshot({ path: resolve(evidence, `${mode}-${engine}-${variant}-projectless-message.png`),
          animations: 'disabled' });
        const calls = mode === 'local' ? fixture.calls
          : await page.evaluate(() => (window as FixtureWindow).cliFixture.calls);
        expect(calls).toContainEqual(expect.objectContaining({ engine, action: 'create', cwd: '', mode: 'plan' }));
        expect(calls).toContainEqual(expect.objectContaining({ engine, action: 'send', text: '你好，介绍一下你能做什么。' }));
        await pane.getByRole('button', { name: '允许这一次', exact: true }).click();
        await input.fill('继续刚才的话题。');
        await expect(send).toBeEnabled(); await send.click();
        await expect(page.getByText('继续刚才的话题。', { exact: true })).toBeVisible();
      });
    }
  }
}
