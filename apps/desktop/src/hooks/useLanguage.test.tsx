// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LANGUAGE_STORAGE_KEY, type Language } from '../i18n';
import { guiText } from '../i18n/guiText';
import { useLanguage } from './useLanguage';

vi.mock('../api/backend', () => ({
  publishLanguageChange: vi.fn().mockResolvedValue(undefined),
  subscribeToLanguageChanges: () => () => undefined,
}));

let root: Root;
let container: HTMLDivElement;
let chooseLanguage: (language: Language) => void;

function LanguageView() {
  const { language, setLanguage, t } = useLanguage();
  chooseLanguage = setLanguage;
  return <div data-language={language}>{t('autoReset.cancel')} / {guiText('取消')}</div>;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  ['zh-CN', 'zh', 'zh-CN', '取消 / 取消'],
  ['en-US', 'en', 'en-US', 'Cancel / Cancel'],
  ['fr-FR', 'en', 'en-US', 'Cancel / Cancel'],
  ['ru-RU', 'en', 'en-US', 'Cancel / Cancel'],
])('renders a fresh %s installation in %s from the first render', async (locale, language, htmlLang, copy) => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(locale);
  await act(async () => root.render(<LanguageView />));
  expect(container.textContent).toBe(copy);
  expect(document.documentElement.lang).toBe(htmlLang);
  expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe(language);
});

it.each(['zh', 'en', 'ru'] as const)('preserves the saved %s choice over the system language', async language => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('fr-FR');
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  await act(async () => root.render(<LanguageView />));
  expect(container.firstElementChild?.getAttribute('data-language')).toBe(language);
});

it('falls back to English for an invalid preference and remembers a manual change', async () => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE');
  localStorage.setItem(LANGUAGE_STORAGE_KEY, 'unsupported');
  await act(async () => root.render(<LanguageView />));
  expect(container.textContent).toBe('Cancel / Cancel');
  await act(async () => chooseLanguage('ru'));
  expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ru');
  expect(container.textContent).toBe('Отмена / Отмена');
});

it('uses the Linux locale at startup and keeps an explicit preference on the next launch', async () => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
  vi.stubGlobal('__REMOTE_AI_SYSTEM_LOCALE__', 'zh_CN.UTF-8');
  await act(async () => root.render(<LanguageView />));
  expect(container.textContent).toBe('取消 / 取消');
  await act(async () => chooseLanguage('en'));
  await act(async () => root.render(null));
  await act(async () => root.render(<LanguageView />));
  expect(container.textContent).toBe('Cancel / Cancel');
});

it('still opens in English and switches language when storage is blocked', async () => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('ja-JP');
  const blocked = () => { throw new Error('storage blocked'); };
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
  await act(async () => root.render(<LanguageView />));
  expect(container.textContent).toBe('Cancel / Cancel');
  await act(async () => chooseLanguage('zh'));
  expect(container.textContent).toBe('取消 / 取消');
});
