import { Check } from 'lucide-react';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import { LANGUAGE_OPTIONS, setLanguage, t, useLanguage } from '../i18n';

export function LanguageSheet({ onClose }: { onClose: () => void }) {
  const language = useLanguage();
  return <AdaptiveSheet open title={t('client.settings.language')} onClose={onClose} width={400}>
    <div role="radiogroup" aria-label={t('client.settings.language')}>
      {LANGUAGE_OPTIONS.map(option => <button key={option.value} type="button" className="settings-row"
        role="radio" aria-checked={language === option.value} onClick={() => {
          setLanguage(option.value);
          onClose();
        }}>
        <span className="settings-row-label">{option.label}</span>
        {language === option.value && <Check size={18} aria-hidden="true" />}
      </button>)}
    </div>
  </AdaptiveSheet>;
}
