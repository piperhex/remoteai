import { openLanguageSettings, languageControl, languageOption, expectSelectedLanguage } from './language-settings';
import { expect, test, type Page } from '@playwright/test';
import { navigate } from './chat-helpers';
import type { MessageKey } from '@remoteai/i18n';
import { clientMessages, testText } from '../../../scripts/i18n-fixture.mjs';

const LANGUAGE_KEY = 'codex-switch.web.language.v1';

async function signIn(page: Page) {
  await page.goto('./');
  await page.getByRole('textbox', { name: '邮箱', exact: true }).fill('review@example.test');
  await page.getByRole('textbox', { name: '密码', exact: true }).fill('local-review');
  await page.getByRole('button', { name: '登录并查看' }).click();
  await page.getByRole('button', { name: '同意并登录' }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
}

async function chooseEnglish(page: Page) {
  await navigate(page, '设置');
  await openLanguageSettings(page);
  await expectSelectedLanguage(page, '简体中文');
  await languageOption(page, 'English').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
}

test('Chinese default, immediate English switch, persistence and switching back', async ({ page, request }, info) => {
  await request.post('http://127.0.0.1:1491/test/reset');
  await signIn(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await chooseEnglish(page);
  await expect(languageControl(page, 'Language')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Auto-refresh usage 30 minutes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change password', exact: true })).toBeVisible();
  await expect(page.getByText('欢迎回来', { exact: true })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('settings-english.png') });
  await page.reload();
  await navigate(page, 'Settings');
  await expect(languageControl(page, 'Language')).toBeVisible();
  await page.getByRole('button', { name: /About Remote AI/ }).click();
  await expect(page.getByText('Web browser', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to settings' }).click();
  await navigate(page, 'Accounts');
  await expect(page.getByRole('button', { name: 'Show account emails' })).toBeVisible();
  await navigate(page, 'Devices');
  await expect(page.getByRole('heading', { name: 'Devices', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /More actions for/ }).last().click();
  await page.getByRole('menuitem', { name: 'Remove device', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await navigate(page, '2FA');
  await expect(page.getByRole('textbox', { name: 'Search services or accounts' })).toBeVisible();
  await navigate(page, 'Settings');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByText('Sign out of this account?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stay signed in' }).click();
  await openLanguageSettings(page);
  await languageOption(page, '简体中文').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(languageControl(page, '语言')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), LANGUAGE_KEY)).toBe('zh');
});

test('invalid preference falls back to Chinese and language changes reach other tabs', async ({ page, context }) => {
  await page.addInitScript(key => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, 'unsupported');
  }, LANGUAGE_KEY);
  await signIn(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  const second = await context.newPage();
  await second.goto('./');
  await expect(second.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await chooseEnglish(page);
  await expect(second.locator('html')).toHaveAttribute('lang', 'en-US');
  await second.close();
});

test('language switching works when preference storage is unavailable', async ({ page }) => {
  await signIn(page);
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Unavailable', 'SecurityError');
      original.call(this, name, value);
    };
  }, LANGUAGE_KEY);
  await chooseEnglish(page);
  await expect(languageControl(page, 'Language')).toBeVisible();
});

test('translations keep placeholders intact and leave unknown content unchanged', async ({ page }) => {
  const placeholders = (text: string) => [...text.matchAll(/\{\w+\}/g)].map(match => match[0]).sort();
  const chinese = clientMessages('zh');
  for (const [source, translated] of Object.entries(clientMessages('en')) as [string, string][]) {
    expect(translated.trim(), source).not.toBe('');
    expect(placeholders(translated), source).toEqual(placeholders(chinese[source]));
  }
  await page.goto('./');
  const rendered = await page.evaluate(async () => {
    const module = '/web/src/i18n/index.ts';
    const { displayText, setLanguage, t }: typeof import('../src/i18n') = await import(module);
    setLanguage('en');
    const message = t('client.app.willReappearWhenItSignsInToTheDesktopApp', { value1: '我的电脑 {value1}' });
    const title = displayText('A user-supplied title');
    const property = displayText('toString');
    setLanguage('zh');
    return { message, title, property, language: t('client.settings.language') };
  });
  expect(rendered.message).toContain('我的电脑 {value1}');
  expect(rendered.title).toBe('A user-supplied title');
  expect(rendered.property).toBe('toString');
  expect(rendered.language).toBe('语言');
});

test('Russian settings persist and fit narrow and desktop layouts', async ({ page, request }, info) => {
  const ru = (key: MessageKey) => testText(key, {}, 'ru');
  await request.post('http://127.0.0.1:1491/test/reset');
  await signIn(page);
  await navigate(page, '设置');
  await openLanguageSettings(page);
  await languageOption(page, 'Русский').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru-RU');
  const languageName = ru("client.settings.language");
  await expect(languageControl(page, languageName)).toBeVisible();
  await expect(page.getByRole('button', { name: ru("client.settings.changePassword"), exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByText('欢迎回来', { exact: true })).toBeHidden();
  await page.screenshot({ path: info.outputPath('settings-russian.png') });
  await page.reload();
  await navigate(page, ru("client.app.settings"));
  await expect(languageControl(page, languageName)).toBeVisible();
  await openLanguageSettings(page);
  await expectSelectedLanguage(page, 'Русский');
  await languageOption(page, '简体中文').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
});

test('Japanese settings persist and fit narrow and desktop layouts', async ({ page, request }, info) => {
  const ja = (key: MessageKey) => testText(key, {}, 'ja');
  await request.post('http://127.0.0.1:1491/test/reset');
  await signIn(page);
  await navigate(page, '设置');
  await openLanguageSettings(page);
  await languageOption(page, '日本語').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja-JP');
  const languageName = ja("client.settings.language");
  await expect(languageControl(page, languageName)).toBeVisible();
  await expect(page.getByRole('button', { name: ja("client.settings.changePassword"), exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByText('欢迎回来', { exact: true })).toBeHidden();
  await page.screenshot({ path: info.outputPath('settings-japanese.png') });
  await page.reload();
  await navigate(page, ja("client.app.settings"));
  await expect(languageControl(page, languageName)).toBeVisible();
  await openLanguageSettings(page);
  await expectSelectedLanguage(page, '日本語');
  await languageOption(page, '简体中文').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
});
