import { createI18n } from '../engine';
import type { Language } from '../registry';
import zh from '../catalogs/desktop/zh/quotaWindowSync.json';
import en from '../catalogs/desktop/en/quotaWindowSync.json';
import ru from '../catalogs/desktop/ru/quotaWindowSync.json';
import ja from '../catalogs/desktop/ja/quotaWindowSync.json';

// Cloud Web settings explain this per-computer preference without loading the desktop catalog.
const messages = createI18n({ locale: 'en', resources: { zh, en, ru, ja } });
export function quotaWindowSyncText(language: Language, key: keyof typeof en): string {
  return messages.text(key, undefined, language);
}
