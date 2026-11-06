import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, ConfigProvider, theme } from 'antd';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { saveGlobalFontSize, useGuiFontSize, guiFontStyle } from '../../../shared/appearance/fontSize';
import { ChatConnectionHealth } from '../../../shared/remote-chat/views/ChatConnectionHealth';
import { ChatDevices } from '../../../shared/remote-chat/views/ChatDevices';
import { GuiHostPicker } from '../../../shared/conversation/GuiHostPicker';
import { initialChatState, type ChatState } from '../../../shared/remote-chat/client/types';
import { CONNECTION_ERRORS } from '../../../shared/remote-chat/connectionErrors';
import { applyThemeMode } from '../src/utils/themeMode';
import { setThemeMode } from '../../web/src/theme/preference';
import { surfaceDevices } from './chat-surface-theme-fixture';
import { LocalSurfaceComposer, RemoteSurfaceComposer } from './chat-surface-theme-composer';
import styles from '../../../shared/conversation/styles.module.less';
import 'antd/dist/reset.css';
import '../../../shared/remote-chat/views/chat.css';
import '../src/pages/codexGui/remote/remoteGui.less';
import './chat-surface-theme-harness.css';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'remote';
const web = mode === 'web';
await (web ? import('../../web/src/styles.css') : import('../src/styles.css'));
const applyAppearance = web ? setThemeMode : applyThemeMode;
applyAppearance(params.has('dark') ? 'dark' : 'light');
saveGlobalFontSize(params.has('large') ? 20 : 14);
localStorage.removeItem('codex-switch:gui-font-size');
const connected: ChatState = { ...initialChatState(), ready: true, mode: 'direct',
  directEndpoints: {
    local: { host: '192.168.1.4', port: 45678, protocol: 'udp' as const },
    remote: { host: '203.0.113.9', port: 65535, protocol: 'udp' as const },
  },
  publicEndpoints: {
    local: [{ host: '203.0.113.8', port: 54321, protocol: 'udp' as const }],
    remote: [{ host: '2001:db8:1234:5678:abcd:ef01:2345:6789', port: 65535, protocol: 'udp' as const }],
  } };

function SurfaceControls({ toggleTheme }: { toggleTheme: () => void }) {
  const [health, setHealth] = useState(false);
  const [devices, setDevices] = useState(false);
  const [connection, setConnection] = useState<ChatState>(connected);
  const [device, setDevice] = useState<(typeof surfaceDevices)[number] | null>(null);
  const fontSize = useGuiFontSize();
  return <main className={`${styles.page} ${mode === 'remote' ? 'gui-remote-workspace chat-page' : ''}
    ${web ? 'chat-page' : ''} surface-theme-host`} style={guiFontStyle(fontSize)}>
    <header className="surface-theme-toolbar">
      <Button onClick={toggleTheme}>切换主题</Button>
      {mode !== 'local' && <>
        <Button onClick={() => setHealth(true)}>P2P · 连接体验</Button>
        <Button onClick={() => setConnection({ ...initialChatState(), connecting: true })}>等待连接</Button>
        <Button onClick={() => setConnection({ ...initialChatState(),
          connectionIssue: CONNECTION_ERRORS.authorization })}>连接失败</Button>
      </>}
    </header>
    <section className="surface-theme-composer">
      {mode === 'local' ? <>
        <GuiHostPicker active navigation={{ devices: surfaceDevices, current: device,
          authenticated: true, loading: false, error: '', refresh: () => {},
          choose: setDevice, login: () => {} }} />
        <LocalSurfaceComposer />
      </> : <RemoteSurfaceComposer chooseDevice={() => setDevices(true)} />}
    </section>
    {devices && <ChatDevices devices={surfaceDevices} chooseLocal={() => setDevices(false)}
      choose={() => setDevices(false)} onClose={() => setDevices(false)}
      refresh={{ loading: false, error: '', refresh: () => {} }} />}
    {health && <ChatConnectionHealth state={connection} device={{ online: true }}
      reconnect={() => setConnection(connected)} close={() => setHealth(false)} />}
  </main>;
}

function Harness() {
  const [dark, setDark] = useState(params.has('dark'));
  const algorithm = dark ? theme.darkAlgorithm : theme.defaultAlgorithm;
  return <ApplicationTypography><ConfigProvider theme={{
    algorithm: web ? algorithm : [algorithm, theme.compactAlgorithm],
    token: { colorPrimary: web ? '#0b9b7c' : '#35ada7' },
  }}><SurfaceControls toggleTheme={() => {
    applyAppearance(dark ? 'light' : 'dark'); setDark(!dark);
  }} /></ConfigProvider></ApplicationTypography>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
