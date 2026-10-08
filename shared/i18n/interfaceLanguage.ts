import { deviceLanguage, isLanguage, type Language } from './language';

let language: Language | undefined;
const listeners = new Set<() => void>();

export function getInterfaceLanguage(): Language {
  if (language) return language;
  try {
    const stored = globalThis.localStorage?.getItem('codex-switch:language');
    if (isLanguage(stored)) return stored;
  } catch { /* The native app and private browser sessions may not have local storage. */ }
  return deviceLanguage();
}

export function setInterfaceLanguage(next: Language) {
  if (!isLanguage(next) || next === language) return;
  language = next;
  listeners.forEach(listener => listener());
}

export function subscribeInterfaceLanguage(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
