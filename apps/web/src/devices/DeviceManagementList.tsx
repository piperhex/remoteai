import { t, useLanguage } from '../i18n';
import { Info, Layers, RefreshCw, Smartphone } from 'lucide-react';
import type { ComponentProps } from 'react';
import { DeviceCard } from './DeviceCard';
import { DeviceMobileHeader } from './DeviceMobileHeader';
import { DiscoveryBackButton } from '../discovery/DiscoveryPage';
import './styles.css';

type DeviceManagementListProps = Omit<ComponentProps<typeof DeviceCard>, 'device'> & {
  devices: ComponentProps<typeof DeviceCard>['device'][];
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onBack: () => void;
};

export function DeviceManagementList({ devices, refreshing, onRefresh, onBack, ...cardProps }: DeviceManagementListProps) {
  useLanguage();
  const online = devices.filter((device) => device.online).length;
  return <>
    <div className="devices-desktop-back"><DiscoveryBackButton onBack={onBack} /></div>
    <DeviceMobileHeader onBack={onBack} onRefresh={onRefresh} refreshing={refreshing} />
    <div className="page-body devices-page">
    <header className="devices-heading"><h1>{t("client.app.devices.7e708d")}</h1>
      <button className="devices-refresh" type="button" disabled={refreshing} onClick={() => void onRefresh()}
        aria-label={t("client.app.refreshDeviceList")} aria-busy={refreshing}>
        <RefreshCw size={23} className={refreshing ? 'spin' : ''} />
      </button>
    </header>
    <p className="devices-subtitle">{t("client.app.viewDeviceStatusAndSelectACardToSwitchModels")}</p>
    <section className="device-overview" aria-label={t("client.app.deviceSummary")}>
      <div className="device-stat"><span className="device-stat-icon"><Smartphone size={20} aria-hidden /></span>
        <span className="device-stat-label">{t("client.app.onlineNow")}</span><strong>{online}</strong></div>
      <div className="device-stat"><span className="device-stat-icon"><Layers size={20} aria-hidden /></span>
        <span className="device-stat-label">{t("client.app.allDevices")}</span><strong>{devices.length}</strong></div>
    </section>
    {devices.length ? <>
      <div className="device-grid">{devices.map((device) =>
        <DeviceCard key={device.deviceId} device={device} {...cardProps} />)}</div>
      <p className="devices-hint"><Info size={23} aria-hidden />
        <span>{t("client.app.onlineDevicesCannotBeRemoved")}<br />{t("client.app.signOutOnTheDeviceBeforeRemovingIt")}</span></p>
    </> : <div className="devices-empty"><Smartphone size={40} aria-hidden /><h3>{t("client.app.noDevicesYet")}</h3>
      <p>{t("client.app.signInWithTheSameAccountOnYourComputerTo")}</p></div>}
    </div>
  </>;
}
