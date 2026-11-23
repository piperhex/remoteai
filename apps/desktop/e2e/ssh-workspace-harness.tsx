import { useState } from 'react';
import { DashboardNavigation, type DashboardPage } from '../src/components/dashboard/DashboardNavigation';
import DesktopSshPage from '../src/pages/ssh/DesktopSshPage';
import WebSshPage from '../../web/src/discovery/DesktopSshPage';
import { translate } from '../src/i18n';
import { sshFixtureIdentity } from './ssh-cloud-fixture';
import type { TerminalApi } from '../../../shared/terminal/types';
import type { GuiToolsClient } from '../../../shared/remote-chat/guiTools';

const device = { deviceId: 'workstation', name: 'Workstation', online: true, platform: 'linux',
  localProxyRunning: false, capabilities: [], lastSeenAt: new Date().toISOString() };
const scope = JSON.stringify([sshFixtureIdentity.baseUrl, sshFixtureIdentity.userId, device.deviceId]);

export function WorkspaceHarness({ mode, remoteApi, client }: {
  mode: string; remoteApi: TerminalApi; client: GuiToolsClient['terminal'];
}) {
  const [page, change] = useState<DashboardPage>('codexGui');
  const active = page === 'ssh';
  const computers = { devices: [device], current: mode === 'remote' ? device : null, authenticated: true,
    loading: false, error: '', login() {}, refresh() {}, choose() {} };
  return <div className="app-shell sidebar-navigation-shell">
    <aside className="app-sidebar"><div className="brand sidebar-brand"><span className="brand-name">Remote AI</span></div>
      <DashboardNavigation page={page} variant="sidebar" onPageChange={change} t={(key, values) => translate('zh', key, values)} />
    </aside>
    <main style={{ display: 'flex', flexDirection: 'column', padding: 0 }}>
      {mode === 'web' ? <WebSshPage client={client} active={active} connected device={device} devices={[device]}
        chooseDevice={() => {}} scope={scope} /> : <DesktopSshPage active={active} computers={computers}
        identity={sshFixtureIdentity} remote={mode === 'remote' ? { scope, api: remoteApi, ready: true } : null} />}
    </main>
  </div>;
}
