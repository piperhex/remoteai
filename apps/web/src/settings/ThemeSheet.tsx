import { useState } from 'react';
import { Check } from 'lucide-react';
import { THEME_OPTIONS } from '../../../../shared/theme/mode';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import { t } from '../i18n';
import { setThemeMode, useThemeMode } from '../theme/preference';

export function ThemeSheet({ onClose }: { onClose: () => void }) {
  const mode = useThemeMode();
  const [error, setError] = useState(false);
  return <AdaptiveSheet open title={t('外观')} onClose={onClose} width={400}>
    <div role="radiogroup" aria-label={t('外观')}>
      {THEME_OPTIONS.map(option => <button key={option.value} type="button" className="settings-row"
        role="radio" aria-checked={mode === option.value} onClick={() => {
          if (setThemeMode(option.value)) onClose();
          else setError(true);
        }}>
        <span className="settings-row-label">{t(option.label)}</span>
        {mode === option.value && <Check size={18} aria-hidden="true" />}
      </button>)}
      {error && <p role="alert">{t('外观已切换，但未能保存。下次打开应用后请重新选择。')}</p>}
    </div>
  </AdaptiveSheet>;
}
