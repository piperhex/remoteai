import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import { DownloadsPage } from '../src/pages/DownloadsPage';
import { useDesktopDownloads } from '../src/downloads/useDesktopDownloads';
import { DashboardNavigation, type DashboardPage } from '../src/components/dashboard/DashboardNavigation';
import { translate } from '../src/i18n';
import { initialChatState } from '../../../shared/remote-chat/client/types';
import type { DownloadClient } from '../../../shared/remote-chat/downloads';
import type { GuiComputer } from '../src/pages/codexGui/remote/types';
import { ChatFilePreview } from '../../web/src/chat/ChatFilePreview';
import { DEFAULT_CHAT_POLICY, setChatConnectionMode, setChatPolicy } from '../../../shared/remote-chat/policy';
import { nativeBulkFixture, nativeBulkStats } from './native-bulk-fixture';
import 'antd/dist/reset.css';
import '../src/styles.css';

Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
setChatConnectionMode('offline');
const nativeBulk = new URLSearchParams(location.search).has('nativeBulk');
setChatPolicy({ ...DEFAULT_CHAT_POLICY, fileDownloadMaxMb: nativeBulk ? 20 : 1,
  fileBulkEnabled: nativeBulk ? 1 : 0 });
const identity = { baseUrl: 'https://fixture.test', userId: 'owner' };
const auth = { ...identity, enabled: true, authenticated: true, sessionExpired: false };
const fixture = { delay: 500, offsets: [] as { device: string; offset: number }[], nativeBulkStats };
declare global { interface Window { desktopDownloads: typeof fixture } }
window.desktopDownloads = fixture;

function controller(device: string) {
  let state = { ...initialChatState(), ready: true, mode: nativeBulk ? 'relay' as const : 'direct' as const };
  const listeners = new Set<() => void>();
  const downloads: DownloadClient = {
    bulk: nativeBulk && device === 'office' ? nativeBulkFixture() : undefined,
    open: async ({ path }) => ({ id: '11111111-1111-4111-8111-111111111111', size: 8 * 1024 * 1024,
      name: path.split('/').at(-1)!, mimeType: 'application/octet-stream', revision: 'first' }),
    read: async ({ offset, length }) => {
      fixture.offsets.push({ device, offset });
      await new Promise(resolve => setTimeout(resolve, fixture.delay));
      return { offset, data: btoa((device === 'office' ? 'A' : 'B').repeat(length)) };
    },
    close: async () => {}, browse: async () => ({ entries: [], directory: '', truncated: false }),
  };
  const files = { open: (threadId: string, path: string) =>
    downloads.open({ threadId, path, scope: 'project', transferId: 'preview' }),
    read: downloads.read, close: downloads.close };
  return { downloads, files, snapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    disconnect: () => { state = { ...state, ready: false }; listeners.forEach(listener => listener()); } };
}
const office = controller('office');
const home = controller('home');
const devices: GuiComputer[] = ['office', 'home'].map(deviceId => ({ deviceId,
  name: deviceId === 'office' ? '办公电脑' : '家里电脑', platform: 'windows', online: true }));

function Workspace({ device, active }: { device: GuiComputer; active: boolean }) {
  const client = device.deviceId === 'office' ? office : home;
  const [preview, setPreview] = useState(false);
  useDesktopDownloads({ identity, device, controller: client });
  return <div hidden={!active} style={{ padding: 32 }}>
    <h1>{device.name}</h1><button onClick={() => setPreview(true)}>打开安装包</button>
    {active && preview && <ChatFilePreview path={`C:/project/${device.deviceId}.msi`}
      context={{ client: client.files, threadId: 'thread', ready: true }} onClose={() => setPreview(false)} />}
  </div>;
}

function Harness() {
  const [page, setPage] = useState<DashboardPage>('codexGui');
  const [device, setDevice] = useState('office');
  const [owner, setOwner] = useState('owner');
  return <ConfigProvider><div style={{ display: 'flex', minHeight: '100vh' }}>
    <aside style={{ width: 220, padding: 16, borderRight: '1px solid var(--line)' }}>
      <DashboardNavigation variant="sidebar" page={page} onPageChange={setPage}
        t={(key, values) => translate('zh', key, values)} />
    </aside><main style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 12, padding: 16 }}>
        <button onClick={() => setDevice(value => value === 'office' ? 'home' : 'office')}>切换电脑</button>
        <button onClick={() => office.disconnect()}>断开办公电脑</button>
        <button onClick={() => setOwner(value => value === 'owner' ? 'other' : 'owner')}>切换账号</button>
      </div>
      {devices.map(item => <Workspace key={item.deviceId} device={item}
        active={page === 'codexGui' && device === item.deviceId} />)}
      {page === 'downloads' && <DownloadsPage auth={{ ...auth, userId: owner }} />}
      {page === 'logDiagnostics' && <p>日志诊断</p>}
    </main>
  </div></ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
