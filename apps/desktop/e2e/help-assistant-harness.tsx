import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import { HelpAssistant } from '../src/components/helpAssistant/HelpAssistant';
import { HelpAssistantSettingsCard } from '../src/pages/settings/HelpAssistantSettingsCard';
import settingsStyles from '../src/pages/SettingsPage/index.module.less';
import { DashboardNavigation, type DashboardPage } from '../src/components/dashboard/DashboardNavigation';
import { ProxySessionManager } from '../src/components/ProxySessionManager';
import { translate, type Translate } from '../src/i18n';
import { applyThemeColor, DEFAULT_THEME_COLOR } from '../../../shared/appearance/themeColor';
import '../src/styles.css';

const translateMessage: Translate = (key, values) => translate('zh', key, values);

function Harness() {
  const [page, setPage] = useState<DashboardPage>('accounts');
  const [clicks, setClicks] = useState(0);
  const [dark, setDark] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    applyThemeColor(DEFAULT_THEME_COLOR);
  }, [dark]);
  return <ConfigProvider theme={{ token: { motion: false } }}>
    <div style={{ display: 'flex', height: '100dvh' }}>
      <aside style={{ width: 208, padding: 20, borderRight: '1px solid var(--line)' }}>
        <h2>Remote AI</h2>
        <DashboardNavigation variant="sidebar" t={translateMessage} page={page} onPageChange={setPage} />
      </aside>
      <main style={{ padding: 24, flex: 1, minWidth: 0 }}>
        <h2>Remote AI</h2><output aria-label="Current page">{page}</output>
        <p><button onClick={() => setClicks((value) => value + 1)}>Click {clicks}</button></p>
        <button onClick={() => setDark((value) => !value)}>Toggle theme</button>
        {page === 'settings' && <div className={settingsStyles.styleScope}>
          <HelpAssistantSettingsCard language="zh" />
        </div>}
        <div style={{ height: 250 }}><ProxySessionManager t={translateMessage} /></div>
      </main>
    </div>
    <HelpAssistant language="zh" page={page} onOpenCodex={() => setPage('codexGui')} />
  </ConfigProvider>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
