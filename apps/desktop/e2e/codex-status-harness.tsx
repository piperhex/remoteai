import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { Composer } from '../src/pages/codexGui/Composer';
import { GuiController } from '../src/pages/codexGui/controller';
import { ChatComposer } from '../../../shared/remote-chat/views/ChatComposer';
import type { ComposerProps } from '../../../shared/remote-chat/views/composerProps';
import { initialSettings, settingsFixture } from '../../../shared/remote-chat/testing/settingsFixture';
import { createGuiToolsClient } from '../../../shared/remote-chat/guiTools';
import { CodexStatusSettingsCard } from '../src/pages/settings/CodexStatusSettingsCard';
import { StatusRefreshSettings } from '../../../shared/codex-status/StatusRefreshSettings';
import { RemoteStatusSurface } from '../../../shared/codex-status/RemoteStatusSurface';
import { ProviderBrowser } from '../../../shared/provider-market/ProviderBrowser';
import { useWebsiteTabs } from '../../../shared/file-preview/workspace/useWebsiteTabs';
import { CODEX_STATUS_URL } from '../../../shared/codex-status/status';
import { AdaptiveSheet } from '../../../shared/layout/AdaptiveSheet';
import { setGuiLanguage, uiText } from '../../../shared/localization/uiText';
import { useGuiLanguage } from '../../../shared/localization/useGuiLanguage';
import { setThemeMode } from '../../web/src/theme/preference';
import { BrowserClientContext, localBrowserClient } from '../../../shared/file-preview/workspace/browserClient';
import type { Language } from '../../../shared/localization/language';
import styles from '../../../shared/conversation/styles.module.less';
import 'antd/dist/reset.css';
import '../src/styles.css';
import '../src/pages/SettingsPage/index.module.less';
import '../../web/src/settings/styles.css';
import '../src/pages/codexGui/remote/remoteGui.less';
import './codex-status-harness.css';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'local';
const dark = params.has('dark');
setThemeMode(dark ? 'dark' : 'light');
setGuiLanguage('zh');
const controller = new GuiController();
const localState = { ...controller.getSnapshot(), connection: 'ready' as const, models: settingsFixture.models,
  settings: { ...controller.getSnapshot().settings, ...initialSettings } };
const remote = createGuiToolsClient(async <T,>(body: object) => {
  const response = await fetch('/fixture-remote', { method: 'POST', body: JSON.stringify(body) });
  if (!response.ok) throw new Error('offline');
  return response.json() as Promise<T>;
});
const browserClient = { native: false, request: remote.browser, subscribe: async () => () => {} };
const remoteProps: ComposerProps = {
  ...settingsFixture, selection: initialSettings, threadId: null, cliVersion: '0.166.0',
  readUsage: async () => null, readConversationMetrics: async () => ({}),
  readServiceStatus: remote.serviceStatus, serviceStatusConnected: true,
  active: true, ready: true, sending: false, running: false, settingsBusy: false, settingsError: '',
  compacting: false, compactReason: null, cwd: '', goalBusy: false,
  updateSettings: async () => {}, interrupt: async () => {}, compact: async () => true, send: async () => true,
  goals: { load: async () => {}, clear: async () => true },
  catalog: { skills: [], loaded: true, loading: false, error: '', refresh: () => {} },
  loadFiles: async () => ({ directory: '', parent: null, entries: [], truncated: false }),
  loadCatalog: async () => ({ data: [], plugins: [] }),
  loadConversations: async () => ({ data: [], nextCursor: null }),
};

function Harness() {
  useGuiLanguage();
  const [settings, setSettings] = useState(false);
  const [connected, setConnected] = useState(true);
  return <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
    <BrowserClientContext.Provider value={mode === 'local' ? localBrowserClient : browserClient}>
    <div className={`${styles.page} chat-page ${mode === 'remote' ? 'gui-remote-workspace' : ''} status-fixture`}>
      <header><strong>Codex GUI</strong><span>{mode === 'local' ? '本地' : '远程电脑'}</span>
        <button onClick={() => setSettings(true)}>设置</button>
        <button onClick={() => setConnected(value => !value)}>切换连接</button>
        <select aria-label="Language" onChange={event => setGuiLanguage(event.target.value as Language)}
          defaultValue="zh">{['zh', 'en', 'ja', 'ru'].map(value => <option key={value}>{value}</option>)}</select>
      </header>
      <main><div className="status-fixture-intro"><h1>Codex</h1><p>今天想完成什么？</p></div>
        <div className="chat-conversation status-fixture-composer">{mode === 'local'
          ? <Composer controller={controller} state={localState} active cliVersion="0.166.0" />
          : <ChatComposer {...remoteProps} serviceStatusConnected={connected} />}</div>
      </main>
      <AdaptiveSheet open={settings} onClose={() => setSettings(false)} width={mode === 'web' ? 400 : 560}
        title={uiText('client.codexStatus.settingsTitle')}>
        <div style={{ padding: 20 }}>{mode === 'web' ? <StatusRefreshSettings t={uiText} />
          : <CodexStatusSettingsCard />}</div>
      </AdaptiveSheet>
    </div>
    </BrowserClientContext.Provider>
  </ConfigProvider>;
}
function LiveBrowserPreview() {
  const browser = useWebsiteTabs();
  const [open, setOpen] = useState(true);
  useEffect(() => { browser.open(CODEX_STATUS_URL, true); }, [browser.open]);
  if (!open) return null;
  return <ProviderBrowser {...browser} open={open} language="zh" Surface={RemoteStatusSurface}
    title={uiText('client.codexStatus.title')} onClose={() => setOpen(false)} />;
}
createRoot(document.getElementById('root')!).render(params.has('remotePreview') ? <LiveBrowserPreview /> : <Harness />);
