import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import type { ForwardingClient } from '../src/pages/codexGui/portForwarding/service';
import type { TerminalLinkReply } from '../../../shared/terminal/links';
import { PortForwarding } from '../src/pages/codexGui/portForwarding/PortForwarding';
import { GuiRemoteDesktop } from '../src/pages/codexGui/GuiRemoteDesktop';
import { desktopClient } from '../../../shared/remote-desktop/protocol';
import { setGuiLanguage } from "../src/i18n/uiText";
import { DetailsWorkspace } from '../src/pages/codexGui/DetailsWorkspace';
import { FileEnvironmentContext, type FileEnvironment } from '../src/pages/codexGui/fileEnvironment';
import { fileApi } from '../src/pages/codexGui/fileApi';
import { filePreviewApi } from '../src/pages/codexGui/filePreview/api';
import { websitePreviewApi } from '../src/pages/codexGui/filePreview/websiteApi';
import { exchangeMappingFixture, mappingFixtureScope } from './port-mapping-sync-fixture';
import type { MappingDocument } from '../../../shared/port-mapping/sync';

setGuiLanguage('zh');
const listeners = new Map<string, () => void>();
const resources = new Set<string>();
const openedPorts = new Set<number>();
const openedUdpPorts = new Set<number>();
const targetUrls: string[] = [];
const client: ForwardingClient = {
  stream: async () => ({ read: async () => new Promise(() => {}), write: async () => {}, close() {} }),
  openResource: async url => {
    targetUrls.push(url); const id = crypto.randomUUID(); resources.add(id); return id;
  },
  closeResource: async id => { resources.delete(id); },
  link: async (_id, request) => {
    if (request.type === 'connect' || request.type === 'udpConnect') return { type: 'socket', id: crypto.randomUUID() };
    if (request.type === 'udpRead') return new Promise((_resolve, reject) => {
      listeners.set(request.id, () => reject(new Error('Closed')));
    });
    if (request.type === 'udpClose') { listeners.get(request.id)?.(); listeners.delete(request.id); }
    return { type: 'done' };
  },
};
const clipboard: string[] = [];
const browserUrls: string[] = [];
const previewUrls: string[] = [];
const resolvedUrls: string[] = [];
const fixture = { resources, openedPorts, openedUdpPorts, targetUrls, clipboard, browserUrls, previewUrls,
  resolvedUrls, failBrowser: false };
websitePreviewApi.sync = async request => { previewUrls.push(request.url); };
websitePreviewApi.close = async () => {};
const environment: FileEnvironment = { remote: new URLSearchParams(location.search).get('mode') !== 'local',
  actions: fileApi, previews: filePreviewApi,
  resolveWebsite: async url => { resolvedUrls.push(url); throw new Error('Already forwarded URLs must stay local'); },
  image: () => null };
Object.defineProperty(navigator, 'clipboard', { configurable: true,
  value: { writeText: async (text: string) => { clipboard.push(text); } } });
Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: {
  invoke: async (command: string, args: { request: { type: string; port: number; scope: string }; url?: string;
    deviceId: string; document?: MappingDocument }) => {
    if (command === 'sync_port_mappings') return exchangeMappingFixture(args);
    if (command === 'plugin:opener|open_url') {
      if (fixture.failBrowser) throw new Error('Private browser failure');
      browserUrls.push(args.url!); return;
    }
    if (command !== 'codex_gui_terminal_link') return;
    const request = args.request;
    if (request.type === 'listen' || request.type === 'udpListen') {
      const ports = request.type === 'listen' ? openedPorts : openedUdpPorts;
      if (request.port === 9999 || ports.has(request.port)) throw '本地端口已被占用，请换一个端口。';
      ports.add(request.port);
      return { type: 'listener', id: `${request.type === 'listen' ? 'local' : 'udp'}-${request.port}`, port: request.port };
    }
    if (request.type === 'accept' || request.type === 'udpRead') return new Promise<TerminalLinkReply>((_resolve, reject) => {
      listeners.set(request.scope, () => reject(new Error('Closed')));
    });
    if (request.type === 'stop' || request.type === 'udpClose') {
      const ports = request.type === 'stop' ? openedPorts : openedUdpPorts;
      ports.delete(Number(request.scope.replace(/^(local|udp)-/, '')));
      listeners.get(request.scope)?.(); listeners.delete(request.scope);
    }
    return { type: 'done' };
  },
}, portForwardingFixture: fixture });

function Harness() {
  const [connected, setConnected] = useState(true);
  const [device, setDevice] = useState('Office PC');
  const [dark, setDark] = useState(false);
  return <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: { colorPrimary: '#168348' } }}>
    <FileEnvironmentContext.Provider value={environment}>
    <DetailsWorkspace selected={device} active className="preview-workspace">
    <main data-dark={dark}>
      <header className="toolbar"><strong>{device}</strong>
        {['Office PC', 'Home PC'].map(name => <div key={name} hidden={device !== name}>
          <PortForwarding client={client} scope={mappingFixtureScope(name)} connected={connected}
            active={device === name} />
        </div>)}
        <GuiRemoteDesktop client={desktopClient(async () => { throw new Error('Fixture'); })}
          active connected={false} /><span>ZH</span><span>{connected ? 'P2P' : '离线'}</span>
      </header>
      <div className="controls">
        <button onClick={() => setConnected(value => !value)}>{connected ? '断开连接' : '重新连接'}</button>
        <button onClick={() => setDevice(value => value === 'Office PC' ? 'Home PC' : 'Office PC')}>切换电脑</button>
        <button onClick={() => setDark(value => !value)}>切换深色</button>
      </div>
    </main>
    </DetailsWorkspace>
    </FileEnvironmentContext.Provider>
  </ConfigProvider>;
}

const style = document.createElement('style');
style.textContent = `*{box-sizing:border-box}body{margin:0;font:14px "Microsoft YaHei",sans-serif}
  :root{--ink:#233329;--panel:#fff;--bg:#f6f8f7;--line:#dfe6e1;--muted:#66796d;--green:#168348}
  body:has([data-dark="true"]){--ink:#e4ece8;--panel:#202722;--bg:#161b18;
    --line:#38463d;--muted:#9caf9f;--green:#6ec89a}
  body{background:var(--bg);color:var(--ink)}.preview-workspace{height:100vh}main{min-height:100vh}
  .toolbar{height:48px;display:flex;
  align-items:center;gap:10px;padding:8px 18px;background:var(--panel)}.toolbar strong{flex:1}
  .controls{display:flex;gap:8px;padding:24px}.toolbar>div[hidden]{display:none}`;
document.head.append(style);
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
