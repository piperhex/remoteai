import { displayText, displayError } from '../../../../../shared/localization/uiText';
import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Switch, Tooltip, Typography } from 'antd';
import { Check, CircleHelp, Clipboard, Copy, FileText, Monitor, Mouse, Power, Upload, Volume2, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { invoke } from '../../api/backend';
import { uiText } from "../../../../../shared/localization/uiText";
import type { DesktopPermissions } from '../../../../../shared/remote-desktop/protocol';
import { UnattendedDesktopSettings } from './UnattendedDesktopSettings';
import { DesktopSystemPermissions } from './DesktopSystemPermissions';
import styles from './RemoteDesktopSettingsModal.module.less';

/** Presentation keys are resolved at render time so mounted views follow language changes. */
const fields: { key: keyof DesktopPermissions; title: string; description: string; icon: LucideIcon }[] = [
  { key: 'enabled', title: "client.desktopRemoteSettings.allowRemoteDesktopAccess", description: "client.desktopRemoteSettings.viewThisComputerSDesktop", icon: Monitor },
  { key: 'control', title: "client.desktopRemoteSettings.allowMouseAndKeyboardControl", description: "client.desktopRemoteSettings.controlMouseAndKeyboardInput", icon: Mouse },
  { key: 'clipboardRead', title: "client.desktopRemoteSettings.allowCopyingFromThisComputer", description: "client.desktopRemoteSettings.copyTextAndFilesFromTheComputer", icon: FileText },
  { key: 'clipboardWrite', title: "client.desktopRemoteSettings.allowPastingToThisComputer", description: "client.desktopRemoteSettings.pasteTextAndFilesToTheComputer", icon: Clipboard },
  { key: 'files', title: "client.desktopRemoteSettings.allowFileTransferThroughTheClipboard", description: "client.desktopRemoteSettings.sendAndReceiveFilesThroughTheClipboard", icon: Upload },
  { key: 'audio', title: "client.desktopRemoteSettings.allowComputerAudio", description: "client.desktopRemoteSettings.playTheComputerSAudioOnTheConnectedDevice", icon: Volume2 },
];

interface RemoteDesktopSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

function useRemoteDesktopSettings() {
  const [permissions, setPermissions] = useState<DesktopPermissions>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  useEffect(() => {
    let active = true;
    void invoke<string>('remote_chat_identity').then(value => { if (active) setFingerprint(value); })
      .catch(() => { if (active) setError('设备指纹暂时无法读取，请重启应用后重试。'); });
    void invoke<DesktopPermissions>('remote_desktop_permissions').then(value => {
      if (active) setPermissions(value);
    }).catch(() => { if (active) setError('远程桌面设置未能读取，请重新打开设置页面。'); });
    return () => { active = false; };
  }, []);
  const save = async (settings: DesktopPermissions) => {
    if (saving) return;
    setSaving(true); setError('');
    try { setPermissions(await invoke<DesktopPermissions>('remote_desktop_permissions', { settings })); }
    catch { setError('设置未能保存，请重试。'); }
    finally { setSaving(false); }
  };
  return { permissions, saving, error, fingerprint, save };
}

function PermissionCards({ permissions, saving, save }: ReturnType<typeof useRemoteDesktopSettings>) {
  return <div className={styles.permissions}>
    {fields.map(({ key, title, description, icon: Icon }) => <div key={key} className={styles.permission}>
      <span className={styles.permissionIcon}><Icon size={26} strokeWidth={1.7} aria-hidden /></span>
      <div className={styles.permissionCopy}>
        <label htmlFor={`remote-desktop-${key}`}>{displayText(title)}</label>
        <p id={`remote-desktop-${key}-description`}>{displayText(description)}</p>
      </div>
      <Switch id={`remote-desktop-${key}`} checked={permissions?.[key] ?? false}
        aria-describedby={`remote-desktop-${key}-description`}
        disabled={!permissions || saving || (key !== 'enabled' && !permissions.enabled)}
        onChange={value => permissions && void save({ ...permissions, [key]: value })} />
    </div>)}
  </div>;
}

function DeviceFingerprint({ value }: { value: string }) {
  return <section className={styles.fingerprint} aria-label={uiText("client.remoteDesktop.deviceFingerprint")}>
    <div className={styles.fingerprintHeading}>
      <h3>{uiText("client.remoteDesktop.deviceFingerprint")}</h3>
      <Tooltip title={uiText("client.desktopRemoteSettings.useItToVerifyThisComputerSIdentityAndMake")} styles={{ root: { maxWidth: 400 } }}>
        <button type="button" className={styles.help} aria-label={uiText("client.desktopRemoteSettings.aboutTheDeviceFingerprint")}>
          <CircleHelp size={18} aria-hidden />
        </button>
      </Tooltip>
    </div>
    <Typography.Text className={styles.fingerprintValue} copyable={{ text: value,
      icon: [<Copy size={19} key="copy" aria-hidden />, <Check size={19} key="copied" aria-hidden />],
      tooltips: [uiText("client.desktopRemoteSettings.copyDeviceFingerprint"), uiText("client.chat.copied")], }}>
      <span>{value}</span>
    </Typography.Text>
  </section>;
}

export function RemoteDesktopSettingsModal({ open, onClose }: RemoteDesktopSettingsModalProps) {
  const settings = useRemoteDesktopSettings();
  const { permissions, saving, error, fingerprint, save } = settings;
  return <Modal title={uiText("client.desktopRemoteSettings.remoteSettings")} open={open} onCancel={onClose} footer={null} width={880} centered
    className={styles.modal} closeIcon={<X size={22} aria-hidden />}>
    <div className={styles.content}>
      <p className={styles.intro}>
        {uiText("client.desktopRemoteSettings.chooseWhatOtherDevicesCanDoOnThisComputerChanging")}
      </p>
      <DesktopSystemPermissions active={open} />
      <PermissionCards {...settings} />
      <Button danger className={styles.disconnect} icon={<Power size={20} aria-hidden />}
        disabled={!permissions?.enabled || saving}
        onClick={() => permissions && void save({ ...permissions, enabled: false })}>{uiText("client.desktopRemoteSettings.disconnectAndPauseRemoteDesktop")}</Button>
      {!!error && <Alert type="error" showIcon message={displayError(error)} className={styles.error} />}
      {!!fingerprint && <DeviceFingerprint value={fingerprint} />}
      <UnattendedDesktopSettings allowed={permissions?.enabled ?? false} />
    </div>
  </Modal>;
}
