import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import type { ComputerUsePermissions } from '../src/api/computerUse';

const permissions: ComputerUsePermissions = { screenRecording: true, accessibility: true, restartRequired: [] };
const settingsOpened = !new URLSearchParams(location.search).has('settings-fail');
document.body.dataset.repairs = '0';
document.body.dataset.restarts = '0';
mockIPC(async (command, payload) => {
  if (command === 'remote_desktop_system_permissions') return { ...permissions };
  if (command === 'remote_desktop_repair_system_permission') {
    const permission = (payload as Record<string, unknown>).permission;
    if (permission !== 'screenRecording' && permission !== 'accessibility') throw new Error('Invalid permission');
    await new Promise(resolve => setTimeout(resolve, 100));
    permissions[permission] = false;
    permissions.restartRequired = [permission];
    document.body.dataset.repairs = String(Number(document.body.dataset.repairs) + 1);
    document.body.dataset.permission = permission;
    return { settingsOpened };
  }
  if (command === 'plugin:process|restart') {
    document.body.dataset.restarts = String(Number(document.body.dataset.restarts) + 1);
  }
});
const { DesktopSystemPermissions } = await import('../src/pages/settings/DesktopSystemPermissions');
document.body.style.cssText = 'margin:0;padding:32px;font:14px system-ui;background:#f6f7f8';
createRoot(document.getElementById('root')!).render(
  <main style={{ width: '100%', maxWidth: 400, margin: 'auto', padding: 24, background: 'white', borderRadius: 12 }}>
    <h2>远程设置</h2><DesktopSystemPermissions active />
  </main>,
);
