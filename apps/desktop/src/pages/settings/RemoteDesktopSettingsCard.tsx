import { useState } from 'react';
import { Button } from 'antd';
import { Monitor } from 'lucide-react';
import { isDesktopApp } from '../../api/backend';
import { uiText } from "../../../../../shared/localization/uiText";
import { useGuiLanguage } from '../../../../../shared/localization/useGuiLanguage';
import { RemoteDesktopSettingsModal } from './RemoteDesktopSettingsModal';

export function RemoteDesktopSettingsCard() {
  useGuiLanguage();
  const [open, setOpen] = useState(false);
  if (!isDesktopApp) return null;
  return <>
    <section className="settings-card">
      <div className="settings-icon"><Monitor size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy"><h3>{uiText("client.remoteDesktop.remoteDesktop")}</h3>
          <p>{uiText("client.desktopRemoteSettings.manageHowOtherDevicesCanAccessThisComputer")}</p></div>
        <div className="settings-field">
          <Button onClick={() => setOpen(true)}>{uiText("client.desktopRemoteSettings.remoteSettings")}</Button>
        </div>
      </div>
    </section>
    <RemoteDesktopSettingsModal open={open} onClose={() => setOpen(false)} />
  </>;
}
