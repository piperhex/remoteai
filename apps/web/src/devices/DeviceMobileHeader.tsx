import { ChevronLeft, RefreshCw } from 'lucide-react';
import { t, useLanguage } from '../i18n';

export function DeviceMobileHeader({ onBack, onRefresh, refreshing }: {
  onBack: () => void;
  onRefresh: () => Promise<void>;
  refreshing: boolean;
}) {
  useLanguage();
  return <header className="devices-mobile-header">
    <button type="button" className="devices-back" aria-label={t('client.discovery.back')} onClick={onBack}>
      <ChevronLeft size={22} aria-hidden="true" /><span>{t('client.discovery.title')}</span>
    </button>
    <h1>{t('client.app.devices.7e708d')}</h1>
    <button type="button" className="devices-mobile-refresh" disabled={refreshing}
      onClick={() => void onRefresh()} aria-label={t('client.app.refreshDeviceList')} aria-busy={refreshing}>
      <RefreshCw size={23} className={refreshing ? 'spin' : ''} aria-hidden="true" />
    </button>
  </header>;
}
