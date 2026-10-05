import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DownloadManagerPage } from '../src/downloads/DownloadManagerPage';
import { downloadManager } from '../src/downloads/manager';
import { ChatFilePreview } from '../src/chat/ChatFilePreview';
import type { DownloadClient } from '../../../shared/remote-chat/downloads';
import type { FileClient } from '../../../shared/remote-chat/fileDownload';
import type { ConnectionMode } from '../../../shared/remote-chat/protocol';
import { DEFAULT_CHAT_POLICY, setChatConnectionMode, setChatPolicy } from '../../../shared/remote-chat/policy';
import '../src/styles.css';
import '../src/chat/chat.css';
import '../src/chat/messages.css';
import { fixtureBulkClient } from './bulk-download-fixture';

Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });

const fixture = { size: 4 * 1024 * 1024, revision: 'first', corrupt: false, offsets: [] as number[], closes: 0,
  bulk: false, recordBytes: 0, wireBytes: 0, cipherFailure: false, directAttempt: () => {},
  downloadLimit: (value: number) => setChatPolicy({ ...DEFAULT_CHAT_POLICY, fileDownloadMaxMb: value }),
  delay: 400, active: 0, peak: 0, windowSize: (value: number) =>
    setChatPolicy({ ...DEFAULT_CHAT_POLICY, fileDownloadWindowSize: value }) };
declare global { interface Window { downloadFixture: typeof fixture } }
window.downloadFixture = fixture;
const FILE_ID = '11111111-1111-4111-8111-111111111111';
const EMPTY_ID = '22222222-2222-4222-8222-222222222222';
const bulk = fixtureBulkClient(fixture);
fixture.directAttempt = bulk.directAttempt;
const client: DownloadClient = {
  bulk: bulk.client,
  open: async ({ path }) => ({ id: path.endsWith('empty.txt') ? EMPTY_ID : FILE_ID,
    size: path.endsWith('empty.txt') ? 0 : fixture.size, name: path.split('/').at(-1)!,
    mimeType: 'application/octet-stream', revision: fixture.revision }),
  read: async ({ offset, length }) => {
    fixture.offsets.push(offset);
    fixture.peak = Math.max(fixture.peak, ++fixture.active);
    await new Promise(resolve => setTimeout(resolve, fixture.delay));
    fixture.active--;
    return { offset: fixture.corrupt ? offset + 1 : offset,
      data: btoa((fixture.revision === 'first' ? 'A' : 'B').repeat(length)) };
  },
  close: async () => { fixture.closes++; },
  browse: async ({ directory, scope }) => {
    const root = directory || (scope === 'computer' ? '' : 'C:/project');
    if (scope === 'computer' && !directory) return {
      directory: '', entries: [{ name: 'C:', path: 'C:/', directory: true }], truncated: false,
    };
    return { directory: root, entries: [
      ...(!root.endsWith('/folder') ? [{ name: 'folder', path: `${root}/folder`, directory: true }] : []),
      { name: 'sample.bin', path: `${root}/sample.bin`, directory: false },
      { name: 'empty.txt', path: `${root}/empty.txt`, directory: false },
    ], truncated: false };
  },
};
const files: FileClient = { open: (threadId, path) => client.open({ scope: 'project', threadId, path, transferId: 'preview' }),
  read: client.read, close: client.close };

function Harness() {
  const [visible, setVisible] = useState(true);
  const [preview, setPreview] = useState(false);
  const [ready, setReady] = useState(true);
  const [mode, setMode] = useState<ConnectionMode>('direct');
  const [owner, setOwner] = useState('owner');
  useEffect(() => {
    void downloadManager.initialize();
    setChatConnectionMode(ready ? mode : 'offline');
    bulk.path(mode === 'relay' ? 'relay' : 'direct');
    downloadManager.bind({ owner, ready, mode: ready ? mode : 'offline', deviceId: 'computer', deviceName: '测试电脑',
      threadId: 'thread', cwd: 'C:/project', client, files });
  }, [owner, ready, mode]);
  useEffect(() => () => downloadManager.unbind(files), []);
  return <main>
    <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button onClick={() => setVisible(value => !value)}>切换页面</button>
      <button onClick={() => setPreview(true)}>预览文件</button>
      <button onClick={() => setReady(value => !value)}>{ready ? '断开电脑' : '连接电脑'}</button>
      <button onClick={() => setMode(value => value === 'direct' ? 'relay' : 'direct')}>切换连接方式</button>
      <button onClick={() => setOwner(value => value === 'owner' ? 'other' : 'owner')}>切换用户</button>
    </nav>
    {visible && <DownloadManagerPage owner={owner} onBack={() => setVisible(false)} />}
    {!visible && <p>其他页面</p>}
    {preview && <ChatFilePreview path="C:/project/sample.bin" context={{ client: files, ready, threadId: 'thread',
      load: async path => ({ path, text: 'Download fixture' }) }} onClose={() => setPreview(false)} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
