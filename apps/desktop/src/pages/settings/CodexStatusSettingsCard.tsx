import { Activity } from 'lucide-react';
import { StatusRefreshSettings } from '../../../../../shared/codex-status/StatusRefreshSettings';
import { uiText } from '../../../../../shared/localization/uiText';

export function CodexStatusSettingsCard() {
  return <section className="settings-card">
    <div className="settings-icon"><Activity size={23} /></div>
    <div className="settings-card-content"><div className="settings-card-copy">
      <h3>{uiText('client.codexStatus.settingsTitle')}</h3><StatusRefreshSettings t={uiText} />
    </div></div>
  </section>;
}
