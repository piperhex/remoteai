import { displayError, displayText } from '../../../../../shared/localization/uiText';
import { useEffect, useState } from 'react';
import { Alert, Button } from 'antd';
import { Check, Info, LockKeyhole } from 'lucide-react';
import { invoke } from '../../api/backend';
import { uiText } from "../../../../../shared/localization/uiText";
import styles from './RemoteDesktopSettingsModal.module.less';

interface Status { supported: boolean; installed: boolean; running: boolean }

/** Presentation keys are resolved at render time so mounted views follow language changes. */
const features = [
  { title: "client.desktopRemoteSettings.remoteAccessAnytime", description: "client.desktopRemoteSettings.connectEvenWhenTheScreenIsLockedOrNoOne" },
  { title: "client.desktopRemoteSettings.linkedToYourCloudAccount", description: "client.desktopRemoteSettings.connectFromAnyDeviceWithTheLinkedAccount" },
  { title: "client.desktopRemoteSettings.administratorApproval", description: "client.desktopRemoteSettings.turningItOnOrOffRequiresAdministratorApproval" },
];

function useUnattendedDesktopSettings() {
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void invoke<Status>('remote_desktop_service_status').then(value => { if (active) setStatus(value); })
      .catch(() => { /* Other operating systems and older hosts do not offer this optional Windows service. */ });
    return () => { active = false; };
  }, []);
  const change = async (install: boolean) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const command = install ? 'remote_desktop_service_install' : 'remote_desktop_service_uninstall';
      setStatus(await invoke<Status>(command));
    }
    catch (error) {
      setError(typeof error === 'string' ? error : '无人值守设置未能完成，请重试。');
      try { setStatus(await invoke<Status>('remote_desktop_service_status')); }
      catch { setStatus(current => current && { ...current, running: false }); }
    }
    finally { setBusy(false); }
  };
  return { status, busy, error, change };
}

function serviceStatusLabel(status: Status) {
  if (!status.installed) return uiText("client.desktopRemoteSettings.notEnabled");
  return uiText(status.running ? "client.mobile.running" : "client.desktopRemoteSettings.enabledNotRunning");
}

export function UnattendedDesktopSettings({ allowed }: { allowed: boolean }) {
  const { status, busy, error, change } = useUnattendedDesktopSettings();
  if (!status?.supported) return null;
  return <section className={styles.unattended} aria-label={uiText("client.desktopRemoteSettings.unattendedAccess")}>
    <div className={styles.unattendedCard}>
      <span className={styles.unattendedIcon}><LockKeyhole size={29} strokeWidth={1.8} aria-hidden /></span>
      <div className={styles.unattendedCopy}>
        <div className={styles.unattendedHeading}>
          <h3>{uiText("client.desktopRemoteSettings.unattendedAccess")}</h3>
          <span role="status" className={styles.serviceStatus}
            data-running={status.running}>{serviceStatusLabel(status)}</span>
        </div>
        <p>{uiText("client.desktopRemoteSettings.onceEnabledYouCanAccessThisComputerFromYourPhone")}</p>
        <p>{uiText("client.desktopRemoteSettings.requiresSigningInToYourCloudAccountAndApprovalFrom")}</p>
      </div>
      <div className={styles.unattendedActions}>
        <Button disabled={busy || !allowed} loading={busy} onClick={() => void change(true)}>
          {uiText(status.installed ? "client.desktopRemoteSettings.updateOrReEnable" : "client.desktopRemoteSettings.enableUnattendedAccess")}</Button>
        {status.installed && <Button danger disabled={busy} onClick={() => void change(false)}>
          {uiText("client.desktopRemoteSettings.disableAndUninstall")}</Button>}
      </div>
    </div>
    {!!error && <Alert type="error" showIcon message={displayError(error)} className={styles.error} />}
    <ul className={styles.features}>
      {features.map(feature => <li key={feature.title}>
        <span className={styles.featureCheck}><Check size={17} strokeWidth={2.5} aria-hidden /></span>
        <div><h4>{displayText(feature.title)}</h4><p>{displayText(feature.description)}</p></div>
      </li>)}
    </ul>
    <p className={styles.accountNotice}>
      {uiText("client.desktopRemoteSettings.unattendedAccessStaysLinkedToTheCloudAccountUsedTo")}</p>
    <div className={styles.updateNotice}>
      <Info size={19} aria-hidden />
      <p>{uiText("client.desktopRemoteSettings.theAppChecksForUnattendedAccessUpdatesEachTimeIt")}</p>
    </div>
  </section>;
}
