import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigProvider, theme } from 'antd';
import { ProvidersPage } from '../src/pages/ProvidersPage';
import { RemoteAccountPicker } from '../../../shared/conversation/remote/RemoteAccountPicker';
import { RemoteModelSwitchSheet } from '../../web/src/components/RemoteModelSwitchSheet';
import { ProviderMarketPage } from '../../admin-ui/src/pages/ProviderMarketPage';
import { I18nProvider } from '../../admin-ui/src/i18n-context';
import { isAppLanguage } from '@remoteai/i18n';
import { setLanguage, useLanguage } from '../../../shared/localization/browserLanguage';
import { loadStoredSession } from '../../web/src/api';
import { saveProviderProfile } from '../src/api/backend';
import { translate } from '../src/i18n';
import type { GuiAccountsClient } from '../../../shared/remote-chat/guiAccounts';
import { browserProviders } from './provider-browser-fixture';
import { iconProviders } from './provider-icons-fixture';
import { providerWebsiteOrigin } from '../../../shared/provider-market/providerWebsite';
import { ChatDesktopAccountPicker } from '../../../shared/remote-chat/views/ChatDesktopAccountPicker';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import 'antd/dist/reset.css';
import '../src/styles.css';

loadStoredSession();
const query = new URLSearchParams(location.search);
const mode = query.get('mode') ?? 'local';
// The standalone admin page does not inherit the desktop shell's minimum window width.
if (mode === 'admin') { document.body.style.minWidth = '0'; document.body.style.overflow = 'auto'; }
const requestedLanguage = query.get('language') ?? 'en';
setLanguage(isAppLanguage('web', requestedLanguage) ? requestedLanguage : 'en');
if (mode === 'web') void import('../../web/src/styles.css');
const dark = query.has('dark');
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
const nothing = () => {};
const done = async () => {};
const yes = async () => true;
const guiClient: GuiAccountsClient = {
  read: async () => ({ choices: query.has('icons') ? iconProviders().map(provider => ({
    kind: 'provider' as const, id: provider.id, name: provider.name, detail: provider.model,
    websiteUrl: providerWebsiteOrigin(provider), available: true,
  })) : [], selection: { kind: 'none' }, running: true }),
  select: async (selection) => selection, subscribe: () => nothing,
};
const adminApi = async <T,>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json' } });
  if (!response.ok) throw new Error((await response.json()).message);
  return response.json() as Promise<T>;
};
function Harness() {
  const language = useLanguage();
  const [beats, setBeats] = useState(0);
  const algorithms = [dark ? theme.darkAlgorithm : theme.defaultAlgorithm];
  if (mode === 'local' || mode === 'hosted') algorithms.push(theme.compactAlgorithm);
  useEffect(() => { const timer = setInterval(() => setBeats((n) => n + 1), 50);
    return () => clearInterval(timer); }, []);
  return <ConfigProvider theme={{ algorithm: algorithms,
    token: { motion: false } }}><App><main className={mode === 'local' || mode === 'hosted' ? 'providers-main' : ''}
      style={{ padding: 24, height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <output data-testid="beats">{beats}</output>
    {mode === 'local' || mode === 'hosted' ? <>
      <div id="provider-topbar-actions" />
      <ProvidersPage providers={query.has('icons') ? iconProviders() : query.has('browser') ? browserProviders() : []}
        aggregateApis={[]} providerGroups={[]} accounts={[]} active
        loading={false} saving={false} busyProviderId={null} localProxy={null} proxyBusy={false}
        onStartProxy={nothing} onSave={saveProviderProfile} onSaveAggregateApi={async () => null}
        onRefreshAggregateApis={done} onSwitchAggregateApi={yes} onDeleteAggregateApi={nothing}
        onSwitch={nothing} onSwitchGroup={nothing} onDeactivate={nothing} onSwitchModel={nothing}
        onModelControlChange={nothing} onGroupChange={nothing} onGroupChangeMany={done}
        onProviderGroupsChange={done} onChangeGroupMembers={yes} onAutoSwitchChange={nothing}
        onDelete={nothing} onDeleteMany={async () => []} onImageModelChange={nothing}
        displayMode={query.has('cards') ? 'cards' : 'table'} privacyMode={false}
        tokenUsageRefreshSeconds={2} language={language}
        t={(key, values) => translate(language, key, values)} />
    </> : mode === 'web' && query.has('icons') ? <aside style={{ width: 340, marginTop: 400 }}>
      <ChatDesktopAccountPicker client={guiClient} ready active devices={[]} chooseDevice={nothing} />
    </aside> : mode === 'remote' ? <aside style={{ width: 340, marginTop: 400 }}>
      <RemoteAccountPicker active ready client={guiClient} privacyMode={false}
        computers={{ current: null, devices: [], authenticated: true, loading: false, error: '',
          refresh: nothing, choose: nothing, login: nothing }} />
    </aside> : mode === 'admin' ? <I18nProvider language={language} onLanguageChange={setLanguage}>
      <ProviderMarketPage api={adminApi} canManage={!query.has('readOnly')} canOrder={!query.has('readOnly')}
        canReview={!query.has('readOnly')} canPromote={!query.has('readOnly')} />
    </I18nProvider> : <RemoteModelSwitchSheet device={{ deviceId: 'test-computer', name: 'Test computer',
      platform: 'windows', localProxyRunning: true, capabilities: [], lastSeenAt: '', online: true }}
      accounts={[]} providers={[]} switchingAccountId={null} switchingProviderId={null} onClose={nothing}
      onSwitchAccount={yes} onSwitchProvider={yes} onSwitchProviderGroup={yes} />}
  </main></App></ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<ApplicationTypography><Harness /></ApplicationTypography>);
