import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import type { Channel } from '@tauri-apps/api/core';
import { ConfigProvider, theme } from 'antd';
import TerminalPanel from '../../../shared/terminal/views/TerminalPanel';
import { terminalApi } from '../src/pages/codexGui/terminal/api';
import { useTerminalPanel } from '../../../shared/terminal/views/useTerminalPanel';
import { DetailsWorkspace } from '../../../shared/conversation/DetailsWorkspace';
import { ChatDetailsWorkspace } from '../../../shared/remote-chat/views/ChatDetailsWorkspace';
import { ChatTerminalLayout } from '../../../shared/remote-chat/views/ChatTerminalLayout';
import { ChatTerminal } from '../../web/src/chat/ChatTerminal';
import { RemoteTerminals } from '../src/remoteChat/terminals';
import { createGuiToolsClient } from '../../../shared/remote-chat/guiTools';
import { remoteTerminalApi } from '../../../shared/remote-chat/terminalApi';
import { useRemoteTerminalPanel } from '../../../shared/remote-chat/useRemoteTerminalPanel';
import type { TerminalEvent, TerminalInfo, TerminalRead } from '../../../shared/terminal/types';
import type { SshRemote } from '../../../shared/terminal/ssh';
import { setInterfaceLanguage } from '../../../shared/localization/interfaceLanguage';
import { applyThemeMode } from '../src/utils/themeMode';
import '../src/styles.css';
import '../../../shared/remote-chat/views/chat.css';
import 'antd/dist/reset.css';
import { cloudFixtureCommand, fixtureProfiles } from './ssh-cloud-fixture';
import { useLocalGitDownloads } from '../src/downloads/localGitDownloads';
import { SshDownloadConnection, SshDownloadsPage } from './ssh-downloads-fixture';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';

const mode = new URLSearchParams(location.search).get('mode') ?? 'local';
Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
// The shared fixture imports desktop CSS, whose 820px minimum would enlarge the mobile layout viewport.
if (mode === 'web') document.body.style.minWidth = '320px';
const simulatedShell = new URLSearchParams(location.search).has('cloud');
const probeFingerprint = new URLSearchParams(location.search).get('fingerprint') ?? 'SHA256:fixture';
const bridgePort = Number(new URLSearchParams(location.search).get('bridge') ?? 1498);
const timers = new Map<string, () => void>();
const post = async <T,>(path: string, request: object): Promise<T> => {
  const response = await fetch(`http://127.0.0.1:${bridgePort}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
  });
  const value = await response.json();
  if (value.error) throw new Error(String(value.error));
  return path === '/read' ? value as T : value.data as T;
};
mockIPC(async (command, body) => {
  const cloud = cloudFixtureCommand(command, body);
  if (cloud) return cloud;
  const args = body as { endpoint: SshRemote; request: Record<string, unknown>; id: string;
    onEvent: Channel<TerminalEvent> };
  if (command === 'codex_gui_ssh_probe') return simulatedShell ? probeFingerprint
    : post('/rpc', { type: 'probe', endpoint: args.endpoint });
  if (command === 'codex_gui_ssh_ensure_x11') {
    return post('/rpc', { type: 'ensureX11', options: (body as { options: object }).options });
  }
  if (command === 'codex_gui_ssh_files') return post('/rpc', { type: 'files', id: args.id, request: args.request });
  if (command === 'codex_gui_ssh_command') return simulatedShell ? undefined
    : post('/rpc', { type: 'command', request: args.request });
  if (command === 'codex_gui_ssh_open') {
    if (simulatedShell && (args.request.endpoint as SshRemote).host === 'password.test'
      && args.request.password !== 'fixture-password') throw new Error('client.ssh.authenticationFailed');
    if (simulatedShell && (args.request.endpoint as SshRemote).host === 'key.test'
      && (args.request.privateKey !== 'fixture-private-key' || args.request.passphrase !== 'fixture-passphrase')) {
      throw new Error('client.ssh.authenticationFailed');
    }
    if (simulatedShell) return { id: `ssh-${crypto.randomUUID()}`, cwd: '/', shell: 'SSH',
      ssh: { ...(args.request.endpoint as object), username: args.request.username } };
    const info = await post<TerminalInfo>('/rpc', { type: 'open', request: args.request });
    let cursor = 0; let active = true;
    const poll = async () => {
      const value = await post<TerminalRead>('/read', { id: info.id, cursor });
      if (!active) return;
      cursor = value.cursor; value.events.forEach(event => args.onEvent.onmessage(event));
      if (value.events.some(event => event.type === 'exit')) active = false;
      if (active) setTimeout(() => { void poll(); }, 50);
    };
    timers.set(info.id, () => { active = false; }); void poll();
    return info;
  }
  if (command === 'codex_gui_terminal_open') return { id: crypto.randomUUID(), cwd: '/fixture', shell: 'bash' };
});
const terminals = new RemoteTerminals();
const client = createGuiToolsClient(<T,>(body: object) =>
  terminals.request(body as Record<string, unknown>, 'fixture') as Promise<T>);
client.terminal.ssh.profiles = fixtureProfiles(mode);
const remoteApi = remoteTerminalApi(client.terminal);

function Local() {
  useLocalGitDownloads();
  const panel = useTerminalPanel('/fixture');
  return <><button onClick={panel.toggle}>打开终端</button>
    <div style={{ flex: 1 }}>本地模式</div><TerminalPanel panel={panel} api={terminalApi} active /></>;
}
function Remote() {
  const panel = useRemoteTerminalPanel({ client: client.terminal, cwd: '/fixture', connected: true });
  return <><button onClick={panel.toggle}>打开终端</button>
    <div style={{ flex: 1 }}>远程模式</div><TerminalPanel panel={panel} api={remoteApi} active /></>;
}
function App() {
  const [dark, setDark] = useState(false);
  const [downloads, setDownloads] = useState(false);
  const content = <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <textarea aria-label="聊天输入" style={{ margin: 16 }} />
    {mode === 'local' ? <Local /> : <Remote />}
  </div>;
  const algorithm = dark ? theme.darkAlgorithm : theme.defaultAlgorithm;
  return <ApplicationTypography><ConfigProvider theme={{
    algorithm: mode === 'web' ? algorithm : [algorithm, theme.compactAlgorithm],
  }}>
    <SshDownloadConnection mode={mode} client={client} />
    <div style={{ height: '100vh' }}>
      <div style={{ height: 32 }}><button onClick={() => setInterfaceLanguage('en')}>English</button>
        <button onClick={() => setInterfaceLanguage('zh')}>中文</button>
        <button onClick={() => setInterfaceLanguage('ru')}>Русский</button>
        <button onClick={() => setInterfaceLanguage('ja')}>日本語</button>
        <button onClick={() => setDownloads(!downloads)}>{downloads ? '返回 SSH' : '下载管理'}</button>
        <button onClick={() => {
          applyThemeMode(dark ? 'light' : 'dark'); setDark(!dark);
        }}>切换主题</button></div>
      {downloads && <SshDownloadsPage mode={mode} back={() => setDownloads(false)} />}
      <div hidden={downloads} style={{ height: 'calc(100% - 32px)' }}>
      {mode === 'web' ? <ChatDetailsWorkspace selected="fixture" active enabled>
        <ChatTerminalLayout><div style={{ padding: 16 }}><ChatTerminal client={client.terminal} cwd="/fixture"
          active connected /><textarea aria-label="聊天输入" /></div></ChatTerminalLayout>
      </ChatDetailsWorkspace> : <DetailsWorkspace selected="fixture" active>{content}</DetailsWorkspace>}
      </div>
    </div>
  </ConfigProvider></ApplicationTypography>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
