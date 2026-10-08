import { useCallback, useEffect, useState } from "react";
import { publishLanguageChange, subscribeToLanguageChanges } from "../api/backend";
import { getLocale, LANGUAGE_STORAGE_KEY, isLanguage, translate, type Language } from "../i18n";
import { deviceLanguage } from "../../../../shared/i18n/language";
import { setGuiLanguage } from "../i18n/guiText";

function storedLanguage(): Language {
  try {
    const value = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(value) ? value : deviceLanguage();
  } catch {
    return deviceLanguage();
  }
}

export function useLanguage() {
  const [language, setLanguageState] = useState<Language>(() => {
    const initial = storedLanguage();
    setGuiLanguage(initial);
    return initial;
  });

  useEffect(() => {
    try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language); }
    catch { /* Keep the selected language for this visit. */ }
    document.documentElement.lang = getLocale(language);
    void publishLanguageChange(language).catch(() => undefined);
  }, [language]);

  useEffect(() => subscribeToLanguageChanges((next) => {
    setGuiLanguage(next);
    setLanguageState(next);
  }), []);

  const setLanguage = useCallback((nextLanguage: Language) => {
    setGuiLanguage(nextLanguage);
    try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage); }
    catch { /* Keep the selected language for this visit. */ }
    setLanguageState(nextLanguage);
  }, []);

  const t = useCallback((key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) => (
    translate(language, key, values)
  ), [language]);

  return { language, setLanguage, t };
}
