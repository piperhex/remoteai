import { trayHeaderLanguages } from '@remoteai/i18n/copy/desktop/trayLanguages';
import { guiLanguage } from "../../../../../shared/localization/uiText";
import type { Language } from "../../../../../shared/localization/language";
import type { MenuSnapshot } from "./types";

// Accounts header labels written by system_tray.rs (build_menu) for each tray language.
const ACCOUNTS_HEADER_LANGUAGES = new Map<string, Language>(trayHeaderLanguages);

/**
 * The quick menu runs in its own webview, so it follows the language of the tray menu it mirrors.
 * Before the first snapshot arrives (or if the header is unrecognised) it uses the stored GUI language.
 */
export function quickMenuLanguage(snapshot: MenuSnapshot | null): Language {
  const header = snapshot?.entries.find((entry) => entry.id === "tray:accounts-header");
  return (header && ACCOUNTS_HEADER_LANGUAGES.get(header.text)) || guiLanguage();
}
