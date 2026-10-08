import { useSyncExternalStore } from 'react';
import { setInterfaceLanguage } from '../../../../shared/i18n/interfaceLanguage';
import { DEFAULT_LANGUAGE, deviceLanguage, isLanguage, type Language } from '../../../../shared/i18n/language';

export type { Language } from '../../../../shared/i18n/language';
export const LANGUAGE_KEY = 'codex-switch.web.language.v1';
const listeners = new Set<() => void>();

function readLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch { /* Language switching still works without browser storage. */ }
  return deviceLanguage();
}

let language = readLanguage();
setInterfaceLanguage(language);
export const getLanguage = () => language;
export const getLocale = () => ({ en: 'en-US', zh: 'zh-CN', ru: 'ru-RU' })[language];

function publishLanguage(next: Language) {
  if (next === language) return;
  language = next;
  setInterfaceLanguage(next);
  listeners.forEach(listener => listener());
}

export function setLanguage(next: Language) {
  if (next !== 'zh' && next !== 'en' && next !== 'ru') return;
  try { localStorage.setItem(LANGUAGE_KEY, next); }
  catch { /* Keep the selected language for this visit if storage is unavailable. */ }
  publishLanguage(next);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === LANGUAGE_KEY || event.key === null) publishLanguage(readLanguage());
  });
}

export function useLanguage() {
  return useSyncExternalStore(subscribe, getLanguage, () => DEFAULT_LANGUAGE);
}
