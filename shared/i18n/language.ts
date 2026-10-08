export type Language = 'zh' | 'en' | 'ru';
export const DEFAULT_LANGUAGE: Language = 'en';
export const LANGUAGE_OPTIONS = [
  { value: 'zh', label: '简体中文' },
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
] as const;
export const languageLabel = (language: Language) => LANGUAGE_OPTIONS.find(item => item.value === language)!.label;
export const localeForLanguage = (language: Language) => ({ zh: 'zh-CN', en: 'en-US', ru: 'ru-RU' })[language];
export const isLanguage = (value: unknown): value is Language => value === 'zh' || value === 'en' || value === 'ru';

/** Use Chinese only in a Chinese locale; all other locales fall back to English. */
export function systemLanguage(locale: string): Language {
  return /^zh(?:[-_.@]|$)/i.test(locale.trim()) ? 'zh' : DEFAULT_LANGUAGE;
}

type DesktopLocaleGlobal = typeof globalThis & { __REMOTE_AI_SYSTEM_LOCALE__?: string };

/** Linux supplies its message locale before rendering; other clients use native locale APIs. */
export function deviceLanguage(): Language {
  try {
    const desktopLocale = (globalThis as DesktopLocaleGlobal).__REMOTE_AI_SYSTEM_LOCALE__;
    const locale = desktopLocale || globalThis.navigator?.language || Intl.DateTimeFormat().resolvedOptions().locale;
    return systemLanguage(locale);
  } catch {
    return DEFAULT_LANGUAGE;
  }
}
