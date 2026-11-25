import { useState } from 'react';
import { DashboardNavigation, type DashboardPage } from '../src/components/dashboard/DashboardNavigation';
import DesktopSshPage from '../src/pages/ssh/DesktopSshPage';
import WebSshPage from '../../web/src/discovery/DesktopSshPage';
import { translate } from '../src/i18n';
import { sshFixtureIdentity } from './ssh-cloud-fixture';
import type { TerminalApi } from '../../../shared/terminal/types';
import { createGuiToolsClient, type GuiToolsClient } from '../../../shared/remote-chat/guiTools';
import { RemoteTerminals } from '../src/remoteChat/terminals';
import { remoteTerminalApi } from '../../../shared/remote-chat/terminalApi';

const device = { deviceId: 'workstation', name: 'Workstation', online: true, platform: 'linux',
  localProxyRunning: false, capabilities: [], lastSeenAt: new Date().toISOString() };
const laptop = { ...device, deviceId: 'laptop', name: 'Laptop' };
const offline = { ...device, deviceId: 'offline', name: 'Offline PC', online: false };
const devices = [device, laptop, offline];
const scope = JSON.stringify([sshFixtureIdentity.baseUrl, sshFixtureIdentity.userId, device.deviceId]);

export function WorkspaceHarness({ mode, remoteApi, client }: {
  mode: string; remoteApi: TerminalApi; client: GuiToolsClient['terminal'];
}) {
  const [page, change] = useState<DashboardPage>('codexGui');
  const active = page === 'ssh';
  const [secondApi] = useState(() => {
    const terminals = new RemoteTerminals();
    const other = createGuiToolsClient(<T,>(body: object) =>
      terminals.request(body as Record<string, unknown>, 'laptop') as Promise<T>);
    other.terminal.ssh.profiles = client.ssh.profiles;
    return remoteTerminalApi(other.terminal);
  });
  const [requested, request] = useState('');
  const first = { deviceId: device.deviceId, name: device.name, api: remoteApi, ready: true };
  const hosts = { request, get: (id: string) => id === device.deviceId ? first
    : id === laptop.deviceId && requested === id ? { deviceId: laptop.deviceId, name: laptop.name, api: secondApi, ready: true } : undefined };
  const computers = { devices, localName: 'Studio PC', current: mode === 'remote' ? device : null, authenticated: true,
    loading: false, error: '', login() {}, refresh() {}, choose() {} };
  return <div className="app-shell sidebar-navigation-shell">
    <aside className="app-sidebar"><div className="brand sidebar-brand"><span className="brand-name">Remote AI</span></div>
      <DashboardNavigation page={page} variant="sidebar" onPageChange={change} t={(key, values) => translate('zh', key, values)} />
    </aside>
    <main style={{ display: 'flex', flexDirection: 'column', padding: 0 }}>
      {mode === 'web' ? <WebSshPage active={active} scope={scope} defaultHost={first} directory={{ ...hosts, devices }} />
        : <DesktopSshPage active={active} computers={computers} identity={sshFixtureIdentity} hosts={hosts} />}
    </main>
  </div>;
}
