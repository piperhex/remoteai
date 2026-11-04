import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { LoungePage } from '../../../shared/lounge/LoungePage';
import { useDesktopLounge } from '../src/lounge/useDesktopLounge';
import { DashboardNavigation, type DashboardPage } from '../src/components/dashboard/DashboardNavigation';
import { translate } from '../src/i18n';
import { setGuiLanguage } from '../../../shared/localization/uiText';
import { useGuiLanguage } from '../../../shared/localization/useGuiLanguage';
import { applyThemeMode } from '../src/utils/themeMode';
import type { CloudAuthState } from '../src/types';
import { RemoteAssistance } from '../src/remoteAssistance/RemoteAssistance';
import { assistanceStore } from '../src/remoteAssistance/store';
import 'antd/dist/reset.css';
import '../src/styles.css';
import { DownloadsPage } from '../src/pages/DownloadsPage';
import { CloudAccountIdentity } from '../src/components/dashboard/CloudAccountIdentity';
import { CloudAccountMenu } from '../src/components/dashboard/CloudAccountMenu';
import { CloudAccountModal } from '../src/components/modals/CloudAccountModal';

const parameters = new URLSearchParams(location.search);
const dark = parameters.has('dark');
applyThemeMode(dark ? 'dark' : 'light');
setGuiLanguage('zh');
declare global { interface Window { loungeFixture: {
  setLanguage: typeof setGuiLanguage; setTheme: (mode: 'light' | 'dark') => void;
} } }
const auth: CloudAuthState = { enabled: true, authenticated: true, baseUrl: 'https://lounge.test',
  userEmail: parameters.get('account') ?? 'alice@example.test', userId: 'alice',
  lastSyncAt: null, sessionExpired: false };

function Fixture() {
  const [themeMode, setThemeMode] = useState(dark ? 'dark' : 'light');
  window.loungeFixture = { setLanguage: setGuiLanguage,
    setTheme: mode => { applyThemeMode(mode); setThemeMode(mode); } };
  const language = useGuiLanguage();
  const [page, setPage] = useState<DashboardPage>('accounts');
  const lounge = useDesktopLounge(auth);
  const [accountOpen, setAccountOpen] = useState(false);
  const t = (key: string, values?: Record<string, string | number>) => translate(language, key, values);
  return <ConfigProvider theme={{ algorithm: themeMode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
    <div className="app-shell sidebar-navigation-shell" style={{ gridTemplateRows: '38px 0 minmax(0, 1fr)' }}>
      <div className="window-titlebar" style={{ padding: 8 }}>Remote AI · {parameters.get('mode') ?? 'local'}
        <div className="window-titlebar-tools"><CloudAccountMenu email={auth.userEmail} user={lounge.state.user}
          authenticated loading={false} t={t} menu={{ items: [{ key: 'account', label: t('cloud.accountDetails') }],
            onClick: () => setAccountOpen(true) }} /></div></div>
      <aside className="app-sidebar"><div className="sidebar-brand">Remote AI</div>
        <DashboardNavigation page={page} onPageChange={setPage} loungeUnread={lounge.state.unread}
          loungeAvailable={auth.authenticated}
          variant="sidebar" t={(key, values) => translate(language, key, values)} />
      </aside>
      <main className={page === 'lounge' ? 'lounge-desktop-main' : undefined}>{page === 'lounge' ? <LoungePage controller={lounge.controller}
        onAssistance={parameters.has('assistance') ? assistanceStore.request : undefined}
        mobile={parameters.has('mobile')} onBack={() => setPage('accounts')} />
        : page === 'downloads' ? <DownloadsPage auth={auth} />
          : page === 'settings' ? <div style={{ padding: 24 }}>
            <CloudAccountIdentity controller={lounge.controller} email={auth.userEmail ?? ''}
              onDetails={() => setAccountOpen(true)} /></div>
          : <div style={{ padding: 32 }} data-testid="other-page">{parameters.get('mode') ?? 'local'}</div>}</main>
    </div>
    {parameters.has('assistance') && <RemoteAssistance auth={auth} onLogin={() => {}} />}
    {accountOpen && <CloudAccountModal email={auth.userEmail} baseUrl={auth.baseUrl}
      loungeController={lounge.controller} changingPassword={false} onChangePassword={async () => true}
      onClose={() => setAccountOpen(false)} onOpenPasswordReset={() => {}} t={t} />}
  </ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
