import { useState } from 'react';
import { ConfigProvider, theme } from 'antd';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { applyThemeColor, DEFAULT_THEME_COLOR } from '../../../shared/appearance/themeColor';
import { saveGlobalFontSize } from '../../../shared/appearance/fontSize';
import { DashboardNavigation, type DashboardPage } from '../src/components/dashboard/DashboardNavigation';
import { PortMappingsPage } from '../src/pages/portMappings/PortMappingsPage';
import { MappingSessions } from '../src/pages/portMappings/MappingSessions';
import { PortForwarding } from '../src/pages/codexGui/portForwarding/PortForwarding';
import type { ForwardingClient } from '../src/pages/codexGui/portForwarding/service';
import { BrowserNavigationProvider } from '../../../shared/browser/BrowserNavigationProvider';
import { BrowserPage } from '../../../shared/browser/BrowserPage';
import { RemoteFiles } from '../src/remoteChat/files';
import { translate } from '../src/i18n';
import '../src/styles.css';

const query = new URLSearchParams(location.search);
const dark = query.has('dark');
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
applyThemeColor(DEFAULT_THEME_COLOR);
saveGlobalFontSize(Number(query.get('font') ?? 14));
const identity = { baseUrl: 'https://fixture.test', userId: 'owner' };
const devices = [
  { deviceId: 'office', name: 'Office PC', platform: 'windows', ipAddress: '192.168.1.21', online: true },
  { deviceId: 'studio', name: 'Mac Studio', platform: 'darwin', ipAddress: '192.168.1.22', online: true },
  { deviceId: 'home', name: 'Home PC', platform: 'linux', online: false },
];
const scope = JSON.stringify([identity.baseUrl, identity.userId, devices[0].deviceId]);
const localDevice = query.has('own') ? { deviceId: 'local', name: 'Design PC', platform: 'windows',
  ipAddress: '192.168.1.10', online: true } : undefined;
const mappingDevices = localDevice ? [localDevice, ...devices] : devices;
const computers = { devices, mappingDevices, authenticated: true, current: null, error: '', loading: false,
  choose() {}, login() {}, refresh() {} };
if (localDevice) Object.assign(window, { mappingHostFixture: new RemoteFiles() });

export function MappingHubHarness({ client }: { client: ForwardingClient }) {
  const [page, setPage] = useState<DashboardPage>('codexGui');
  return <ApplicationTypography><ConfigProvider theme={{ algorithm: [
    dark ? theme.darkAlgorithm : theme.defaultAlgorithm, theme.compactAlgorithm] }}>
    <BrowserNavigationProvider onOpen={() => setPage('browser')}>
    <MappingSessions identity={identity} devices={mappingDevices} localDevice={localDevice}>
      <div className="app-shell sidebar-navigation-shell">
        <aside className="app-sidebar">
          <div className="brand sidebar-brand"><span className="brand-name">Remote AI</span></div>
          <DashboardNavigation variant="sidebar" page={page} onPageChange={setPage}
            loungeAvailable t={(key, values) => translate('zh', key, values)} />
        </aside>
        <main>
          {page === 'portMappings' && <PortMappingsPage computers={computers} />}
          {page === 'browser' && <BrowserPage language="zh" active onClose={() => setPage('portMappings')} />}
          {query.get('mode') === 'remote' && <div hidden={page !== 'codexGui'}>
            <PortForwarding scope={scope} client={client} connected active={page === 'codexGui'} /></div>}
        </main>
      </div>
    </MappingSessions></BrowserNavigationProvider>
  </ConfigProvider></ApplicationTypography>;
}
