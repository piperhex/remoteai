import { useEffect, useState } from 'react';
import { Alert, Button, Space } from 'antd';
import { invoke } from '../../api/backend';

interface Status { supported: boolean; installed: boolean; running: boolean }
export function UnattendedDesktopSettings({ allowed }: { allowed: boolean }) {
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void invoke<Status>('remote_desktop_service_status').then(value => { if (active) setStatus(value); })
      .catch(() => { /* Other operating systems and older hosts do not offer this optional Windows service. */ });
    return () => { active = false; };
  }, []);
  if (!status?.supported) return null;
  const change = async (install: boolean) => {
    if (busy) return;
    setBusy(true); setError('');
    try { setStatus(await invoke<Status>(install ? 'remote_desktop_service_install' : 'remote_desktop_service_uninstall')); }
    catch (error) {
      setError(typeof error === 'string' ? error : '无人值守设置未能完成，请重试。');
      try { setStatus(await invoke<Status>('remote_desktop_service_status')); }
      catch { setStatus(current => current && { ...current, running: false }); }
    }
    finally { setBusy(false); }
  };
  return <div style={{ maxWidth: 400 }}>
    <h4>无人值守</h4>
    <p>启用后，可继续用手机或网页访问锁屏、尚未登录的电脑。安装和卸载需要管理员确认。</p>
    <p>无人值守绑定启用时的云端账号，退出应用或云端账号后仍会运行。停止访问请在此停用。</p>
    <p>应用每次启动时会检查已启用的服务，有新版时尝试更新。需要时请确认管理员提示。</p>
    <p role="status">{status.installed ? status.running ? '服务正在运行' : '服务已安装，尚未运行' : '尚未启用'}</p>
    <Space wrap>
      <Button disabled={busy || !allowed} loading={busy} onClick={() => void change(true)}>
        {status.installed ? '更新或重新启用' : '启用无人值守'}</Button>
      {status.installed && <Button danger disabled={busy} onClick={() => void change(false)}>停用并卸载</Button>}
    </Space>
    {!!error && <Alert type="error" message={error} style={{ marginTop: 12 }} />}
  </div>;
}
