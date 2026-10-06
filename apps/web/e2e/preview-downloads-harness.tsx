import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatController } from '../../../shared/remote-chat/client/controller';
import { ChatImage, ChatImageContext } from '../src/chat/ChatImage';
import { downloadManager } from '../src/downloads/manager';
import { createPreviewDownloads } from '../src/downloads/previews';
import { fixtureBulkClient } from './bulk-download-fixture';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { ChatFilePreview } from '../src/chat/ChatFilePreview';
import '../src/styles.css';
import '../src/chat/messages.css';

const THREAD = '33333333-3333-4333-8333-333333333333';
const IMAGE = '44444444-4444-4444-8444-444444444444';
const THUMB = '55555555-5555-4555-8555-555555555555';
const TEXT = '66666666-6666-4666-8666-666666666666';
const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
canvas.getContext('2d')!.fillStyle = 'rgba(24,180,72,0.5)';
canvas.getContext('2d')!.fillRect(0, 0, 16, 32);
const thumb = Uint8Array.from(atob(canvas.toDataURL().split(',')[1]), value => value.charCodeAt(0));
// PNG decoders ignore trailing bytes. The original spans multiple blocks for real resume coverage.
const original = new Uint8Array(2 * 1024 * 1024 + 17); original.set(thumb);
const content = (id: string) => id === THUMB ? thumb : id === TEXT
  ? new TextEncoder().encode('这是统一下载的文本预览。') : original;
const fixture = { size: original.length, revision: 'first', delay: 150, corrupt: false, offsets: [] as number[],
  bulk: true, recordBytes: 0, wireBytes: 0, cipherFailure: false, content,
  requests: [] as Record<string, unknown>[], hash: bytesToHex(sha256(original)),
  tasks: () => downloadManager.snapshot(), pause: (id: string) => downloadManager.pause(id) };
declare global { interface Window { previewFixture: typeof fixture } }
window.previewFixture = fixture;
Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
const bulk = fixtureBulkClient(fixture);
const controller = new ChatController(() => ({ start() {}, stop() {}, request: async <T,>(_method: string, body: unknown) => {
  const request = body as Record<string, unknown>; fixture.requests.push(request);
  if (request.operation === 'fileClose') return undefined as T;
  if (request.operation !== 'previewOpen') throw new Error('Old preview RPC must not carry content');
  const id = request.preview === 'text' ? TEXT : request.preview === 'thumbnail' ? THUMB : IMAGE;
  return { id, name: id === TEXT ? 'preview.txt' : 'image.png', size: content(id).length,
    mimeType: id === TEXT ? 'text/plain' : 'image/png', revision: 'first' } as T;
} }));
controller.downloads.bulk = bulk.client;
controller.previewDownloads = createPreviewDownloads({ owner: 'preview-owner', deviceId: 'preview-pc' });
function Harness() {
  const [text, setText] = useState('');
  const [file, setFile] = useState(false);
  useEffect(() => {
    downloadManager.bind({ owner: 'preview-owner', deviceId: 'preview-pc', deviceName: 'PC', ready: true,
      mode: 'direct', files: controller.files, client: controller.downloads });
    return () => downloadManager.unbind(controller.files);
  }, []);
  return <main style={{ maxWidth: '100%', padding: 12 }}>
    <ChatImageContext.Provider value={{ threadId: THREAD, ready: true, load: controller.imagePreview,
      save: controller.savePreviewImage }}>
      <ChatImage source="./透明图片.png" description="透明图片" />
      <button onClick={() => setFile(true)}>打开图片文件</button>
      {file && <ChatFilePreview path="./透明图片.png" context={{ client: controller.files, ready: true,
        threadId: THREAD, load: controller.textPreview }} onClose={() => setFile(false)} />}
    </ChatImageContext.Provider>
    <button onClick={() => { void controller.textPreview(THREAD, './note.txt').then(value => setText(value.text)); }}>
      查看文本</button><p>{text}</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
