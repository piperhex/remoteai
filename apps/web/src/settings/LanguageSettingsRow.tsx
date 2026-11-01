import { Languages } from 'lucide-react';
import { LanguageSelect } from '../../../../shared/localization/LanguageSelect';
import { LANGUAGE_OPTIONS, languageLabel, setLanguage, t, useLanguage } from '../i18n';
import { useDesktopLayout } from '../useDesktopLayout';
import { SettingsRow } from './SettingsRow';

export function LanguageSettingsRow({ onOpen }: { onOpen: () => void }) {
  const language = useLanguage();
  const desktop = useDesktopLayout();
  if (!desktop) return <SettingsRow label={t('client.settings.language')} value={languageLabel(language)}
    icon={Languages} tone="blue" onClick={onOpen} />;
  return <div className="settings-row">
    <span className="settings-row-icon blue"><Languages size={21} aria-hidden="true" /></span>
    <label className="settings-row-label" htmlFor="settings-language">{t('client.settings.language')}</label>
    <LanguageSelect id="settings-language" label={t('client.settings.language')}
      value={language} options={LANGUAGE_OPTIONS} onChange={setLanguage} />
  </div>;
}
