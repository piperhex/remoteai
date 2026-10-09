import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Space, Switch, Typography } from 'antd';
import { invoke } from '../../api/backend';
import type { DesktopPermissions } from '../../../../../shared/remote-desktop/protocol';
import { UnattendedDesktopSettings } from './UnattendedDesktopSettings';
import { DesktopSystemPermissions } from './DesktopSystemPermissions';

const fields: { key: keyof DesktopPermissions; title: string }[] = [
  { key: 'enabled', title: '允许远程访问桌面' },
  { key: 'control', title: '允许鼠标和键盘操作' },
  { key: 'clipboardRead', title: '允许从电脑复制内容' },
  { key: 'clipboardWrite', title: '允许向电脑粘贴内容' },
  { key: 'files', title: '允许通过剪贴板传输文件' },
  { key: 'audio', title: '允许播放电脑声音' },
];

interface RemoteDesktopSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function RemoteDesktopSettingsModal({ open, onClose }: RemoteDesktopSettingsModalProps) {
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
  return <Modal title="远程设置" open={open} onCancel={onClose} footer={null} width={448} centered
    styles={{ body: { maxWidth: 400, maxHeight: 'calc(100dvh - 160px)', overflowY: 'auto' } }}>
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Text type="secondary">
        选择其他设备可以在这台电脑上进行的操作。更改权限会断开当前远程桌面连接。
      </Typography.Text>
      <DesktopSystemPermissions active={open} />
      {fields.map(field => <div key={field.key}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <label htmlFor={`remote-desktop-${field.key}`}>{field.title}</label>
        <Switch id={`remote-desktop-${field.key}`} checked={permissions?.[field.key] ?? false}
          style={{ flexShrink: 0 }}
          disabled={!permissions || saving || (field.key !== 'enabled' && !permissions.enabled)}
          onChange={value => permissions && void save({ ...permissions, [field.key]: value })} />
      </div>)}
      <Button danger disabled={!permissions?.enabled || saving}
        onClick={() => permissions && void save({ ...permissions, enabled: false })}>断开并暂停远程桌面</Button>
      {!!error && <Alert type="error" message={error} />}
      {!!fingerprint && <div style={{ overflowWrap: 'anywhere', wordBreak: 'break-all' }}>设备指纹：
        <Typography.Text code copyable>{fingerprint}</Typography.Text></div>}
      <UnattendedDesktopSettings allowed={permissions?.enabled ?? false} />
    </Space>
  </Modal>;
}
