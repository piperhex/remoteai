import { Type } from 'lucide-react';
import { GlobalFontSettings } from '../../../../../shared/appearance/GlobalFontSettings';
import { uiText } from '../../../../../shared/localization/uiText';
import styles from './GlobalFontSettingsCard.module.less';

export function GlobalFontSettingsCard() {
  return <section className={`settings-card ${styles.card}`}>
    <div className="settings-icon"><Type size={23} /></div>
    <div className="settings-card-content">
      <div className="settings-card-copy"><h3>{uiText('client.appearance.globalFontSize')}</h3></div>
      <GlobalFontSettings t={uiText} />
    </div>
  </section>;
}
