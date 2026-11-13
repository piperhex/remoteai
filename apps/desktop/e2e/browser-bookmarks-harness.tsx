import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { BrowserPage } from '../../../shared/browser/BrowserPage';
import { BookmarkProvider } from '../../../shared/browser/bookmarks/context';
import { WebsitePreview } from '../../../shared/file-preview/workspace/WebsitePreview';
import { useWebsiteTabs } from '../../../shared/file-preview/workspace/useWebsiteTabs';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { applyThemeColor, DEFAULT_THEME_COLOR } from '../../../shared/appearance/themeColor';
import { DashboardNavigation } from '../src/components/dashboard/DashboardNavigation';
import { translate } from '../src/i18n';
import { setGuiLanguage } from '../../../shared/localization/uiText';
import { browserMappings } from '../../../shared/port-mapping/browserMappings';
import workspaceStyles from '../../../shared/conversation/DetailsWorkspace.module.less';
import '../src/styles.css';
import 'antd/dist/reset.css';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'local';
const dark = params.has('dark');
setGuiLanguage('zh');
localStorage.setItem('codex-switch:global-font-size', params.get('font') ?? '14');
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
applyThemeColor(DEFAULT_THEME_COLOR);

function SidebarBrowser() {
  const browser = useWebsiteTabs();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { browser.onNewTab(); }, [browser.onNewTab]);
  return <WebsitePreview browser={browser} active resizing={false} expanded={expanded}
    toggleExpanded={() => setExpanded(value => !value)} onClose={() => {}} />;
}

function Harness() {
  const [active, setActive] = useState(true);
  useEffect(() => {
    if (!params.has('mapping')) return;
    return browserMappings.register('browser-verification', { subscribe: () => () => {}, snapshot: () => [
      { id: 'website', status: 'running', localPort: 18306, remotePort: 3000 },
      { id: 'udp', status: 'running', protocol: 'udp', localPort: 18307, remotePort: 3001 },
      { id: 'stopped', status: 'stopped', localPort: 18308, remotePort: 3002 },
    ] });
  }, []);
  return <ApplicationTypography><ConfigProvider theme={{ algorithm: [dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    ...(mode === 'web' ? [] : [theme.compactAlgorithm])] }}>
    <BookmarkProvider scope={`bookmarks-${mode}`}>
      <div style={{ height: '100vh', display: 'flex', background: dark ? '#151b25' : '#f4f7fa',
        color: dark ? '#e5e9f0' : '#182230' }}>
        {!params.has('sidebar') && <aside style={{ width: 190, padding: 12, flexShrink: 0 }}>
          <div style={{ padding: '12px 8px', fontWeight: 600 }}>Remote AI</div>
          <DashboardNavigation t={(key, values) => translate('zh', key, values)} page="browser"
            onPageChange={page => setActive(page === 'browser')} variant="sidebar" loungeAvailable />
        </aside>}
        <main style={{ display: 'flex', flex: 1, minWidth: 0, height: '100%' }}>
          {params.has('sidebar') ? <><section style={{ flex: 1, padding: 24 }}>Remote AI</section>
            <aside className={workspaceStyles.host} style={{ width: '65%', display: 'flex' }}>
              <SidebarBrowser /></aside></> : <BrowserPage language="zh" active={active} onClose={() => setActive(false)} />}
        </main>
      </div>
    </BookmarkProvider>
  </ConfigProvider></ApplicationTypography>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
