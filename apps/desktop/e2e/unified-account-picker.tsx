import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { saveGlobalFontSize } from '../../../shared/appearance/fontSize';
import { applyThemeColor, DEFAULT_THEME_COLOR } from '../../../shared/appearance/themeColor';
import { applyThemeMode } from '../src/utils/themeMode';
import { setGuiLanguage } from '../../../shared/localization/uiText';
import { CliGuiProvider } from '../../../shared/cli-gui/context';
import { EngineSelector } from '../../../shared/cli-gui/EngineSelector';
import type { CliTransport } from '../../../shared/cli-gui/types';
import { RemoteAccountPicker } from '../../../shared/conversation/remote/RemoteAccountPicker';
import { ChatDesktopAccountPicker } from '../../../shared/remote-chat/views/ChatDesktopAccountPicker';
import { subscribeGuiEvent } from '../../../shared/conversation/webEvents';
import { readGuiAccounts, selectGuiAccount } from '../src/remoteChat/guiAccounts';
import { ProxyAccountPicker } from '../src/pages/codexGui/ProxyAccountPicker';
import { useGuiAccountSelection } from '../src/pages/codexGui/useGuiAccountSelection';
import { invoke } from '../src/api/backend';
import type { Account } from '../src/types';
import 'antd/dist/reset.css';
import '../src/styles.css';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'local';
const dark = params.has('dark');
setGuiLanguage('zh');
saveGlobalFontSize(Number(params.get('font') ?? 14));
applyThemeColor(DEFAULT_THEME_COLOR);
applyThemeMode(dark ? 'dark' : 'light');
const noop = () => {};
const device = { deviceId: 'test-computer', name: '工作电脑', platform: 'windows', online: true };
const computers = { current: mode === 'local' ? null : device, devices: [device],
  authenticated: true, loading: false, error: '', refresh: noop, choose: noop, login: noop };
const client = { read: readGuiAccounts, select: selectGuiAccount, subscribe: (listener: () => void) => {
  const stop = subscribeGuiEvent<{ method: string }>('codex-gui-event', event => {
    if (event.method === 'claudeAccounts/changed') listener();
  });
  return () => { void stop.then(unsubscribe => unsubscribe()); };
} };
const transport: CliTransport = { request: request => invoke('cli_gui_request', { request }),
  subscribe: () => noop };

function LocalPicker() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => { void invoke<Account[]>('list_accounts').then(setAccounts); }, []);
  const selection = useGuiAccountSelection({ active: true, accounts, providers: [] });
  return <ProxyAccountPicker active computers={computers} privacyMode={false} accounts={selection.accounts}
    providers={selection.providers} aggregateApis={selection.aggregateApis} busy={false}
    loading={selection.loading} onSwitchAccount={selection.switchAccount} onSwitchProvider={selection.switchProvider} />;
}

function Harness() {
  const [beats, setBeats] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setBeats(value => value + 1), 50);
    return () => clearInterval(timer);
  }, []);
  return <ApplicationTypography>
    <ConfigProvider theme={{ algorithm: mode === 'web' ? dark ? theme.darkAlgorithm : theme.defaultAlgorithm
      : [dark ? theme.darkAlgorithm : theme.defaultAlgorithm, theme.compactAlgorithm],
    token: { colorPrimary: DEFAULT_THEME_COLOR, borderRadius: 6 } }}>
      <CliGuiProvider transport={transport}>
        <main className="unified-picker-workspace">
          <aside><h3>对话</h3><div className="unified-picker-space" /><EngineSelector />
            {mode === 'local' ? <LocalPicker /> : mode === 'web'
              ? <ChatDesktopAccountPicker client={client} ready active device={device} devices={[device]}
                chooseDevice={noop} />
              : <RemoteAccountPicker client={client} active ready privacyMode={false} computers={computers}
                renderSettings={() => null} />}
          </aside>
          <section><h3>新建会话</h3><textarea aria-label="消息" placeholder="输入消息…" />
            <output hidden aria-label="刷新次数">{beats}</output></section>
        </main>
      </CliGuiProvider>
    </ConfigProvider>
  </ApplicationTypography>;
}

const style = document.createElement('style');
style.textContent = `.unified-picker-workspace{height:100vh;display:flex;background:var(--panel);color:var(--ink)}
.unified-picker-workspace aside{width:320px;max-width:48vw;padding:18px;display:flex;flex-direction:column;
border-right:1px solid var(--line);--sidebar-inline-padding:18px;--sidebar-bottom-padding:18px}
.unified-picker-space{flex:1}.unified-picker-workspace section{flex:1;padding:24px;display:flex;flex-direction:column}
.unified-picker-workspace textarea{margin-top:auto;background:var(--panel);color:var(--ink);
border:1px solid var(--line);border-radius:8px;padding:12px;min-height:120px;font:inherit}
.unified-picker-workspace h3{font-size:1em;font-weight:600}`;
document.head.append(style);
createRoot(document.getElementById('root')!).render(<Harness />);
