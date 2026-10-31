import { Button, Switch } from 'antd';
import { TimerReset } from 'lucide-react';
import type { Translate } from '../../i18n';
import { useQuotaWindowSync } from '../../hooks/useQuotaWindowSync';

export function QuotaWindowSyncCard({ t }: { t: Translate }) {
  const sync = useQuotaWindowSync();
  return <section className="settings-card">
    <div className="settings-icon"><TimerReset size={23} /></div>
    <div className="settings-card-content">
      <div className="settings-card-copy">
        <h3>{t('settings.quotaWindowSync.title')}</h3>
        <p id="quota-window-sync-description">{t('settings.quotaWindowSync.description')}</p>
        <p>{t('settings.quotaWindowSync.hint')}</p>
        {sync.error && <p role="alert" style={{ maxWidth: 400 }}>
          {t(`settings.quotaWindowSync.${sync.error}`)}
          {sync.error === 'loadError' && <Button size="small" onClick={() => void sync.refresh()}>
            {t('settings.quotaWindowSync.retry')}
          </Button>}
        </p>}
      </div>
      <div className="settings-field">
        <label htmlFor="quota-window-sync">{t('settings.quotaWindowSync.enabled')}</label>
        <Switch id="quota-window-sync" checked={sync.enabled ?? false}
          aria-describedby="quota-window-sync-description" loading={sync.saving}
          disabled={sync.enabled === null || sync.saving}
          checkedChildren={t('settings.autoRefresh.on')} unCheckedChildren={t('settings.autoRefresh.off')}
          onChange={value => void sync.update(value)} />
      </div>
    </div>
  </section>;
}
