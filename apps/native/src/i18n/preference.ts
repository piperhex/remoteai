import * as SecureStore from 'expo-secure-store';
import { setInterfaceLanguage } from '../../../../shared/i18n/interfaceLanguage';
import { deviceLanguage, isLanguage, type Language } from '../../../../shared/i18n/language';

export const LANGUAGE_KEY = 'codex-switch.native.language.v1';
let revision = 0;
let writes = Promise.resolve();

export async function loadLanguage(): Promise<void> {
  const current = revision;
  let saved: string | null = null;
  try { saved = await SecureStore.getItemAsync(LANGUAGE_KEY); }
  catch { /* A language preference must never prevent startup. */ }
  if (current !== revision) return;
  setInterfaceLanguage(isLanguage(saved) ? saved : deviceLanguage());
}

export function setLanguage(language: Language): Promise<boolean> {
  if (!isLanguage(language)) return Promise.resolve(false);
  revision++;
  setInterfaceLanguage(language);
  // Serialize writes so rapid taps cannot restore an older choice on the next launch.
  const saved = writes.then(() => SecureStore.setItemAsync(LANGUAGE_KEY, language));
  writes = saved.catch(() => undefined);
  return saved.then(() => true, () => false);
}
