import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { saveGlobalFontSize } from '../../../shared/appearance/fontSize';
import { DEFAULT_THEME_COLOR } from '../../../shared/appearance/themeColor';
import { RetainedView } from '../../../shared/RetainedView';
import { setNativeDesktopRuntime } from '../../../shared/remote-desktop/runtime';
import type { GuiComputer } from '../../../shared/conversation/remote/types';
import { DashboardNavigation, type DashboardPage } from '../src/components/dashboard/DashboardNavigation';
import DesktopRemoteDesktopPage from '../src/pages/DesktopRemoteDesktopPage';
import { translate } from '../src/i18n';
import { applyThemeMode } from '../src/utils/themeMode';
import '../src/styles.css';

declare global { interface Window { desktopComputers: GuiComputer[] } }
const remote = new URLSearchParams(location.search).has('remote');
const logo = new URL('../src-tauri/icons/128x128.png', import.meta.url).href;
const devices = window.desktopComputers;
const computers = { devices, current: remote ? devices[0] : null, authenticated: true, loading: false,
  error: '', identity: { baseUrl: location.origin, userId: 'viewer' }, refresh() {}, login() {}, choose() {} };
setNativeDesktopRuntime({ createPeer: config => new RTCPeerConnection(config), videoCodecs: async () => ['h264'] });
saveGlobalFontSize(remote ? 20 : 14);
applyThemeMode(remote ? 'dark' : 'light');

function DesktopHarness() {
  const [page, setPage] = useState<DashboardPage>('codexGui');
  return <ApplicationTypography><ConfigProvider theme={{ token: { colorPrimary: DEFAULT_THEME_COLOR },
    algorithm: remote ? [theme.darkAlgorithm, theme.compactAlgorithm] : theme.compactAlgorithm }}>
    <div className={`app-shell sidebar-navigation-shell${remote ? '' : ' sidebar-collapsed'}`}>
      <aside className="app-sidebar"><button type="button" className="brand sidebar-brand" aria-label="Remote AI">
        <img className="brand-logo" src={logo} alt="" /><span className="brand-name">Remote AI</span>
      </button>
        <DashboardNavigation collapsed={!remote} page={page} onPageChange={setPage} variant="sidebar"
          t={(key, values) => translate('zh', key, values)} />
      </aside>
      <main style={{ display: 'flex', flexDirection: 'column', padding: 0 }}>
        <RetainedView active={page === 'remoteDesktop'}><DesktopRemoteDesktopPage computers={computers} /></RetainedView>
      </main>
    </div>
  </ConfigProvider></ApplicationTypography>;
}
createRoot(document.getElementById('root')!).render(<DesktopHarness />);
