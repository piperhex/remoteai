import ReactNativeBlobUtil from 'react-native-blob-util';
import { randomUUID } from 'expo-crypto';
import { PreviewDownloads, type PreviewSource } from '../../../../shared/remote-chat/previewDownloads';
import { transferFileChunks, validateFileInfo } from '../../../../shared/remote-chat/fileDownload';
import type { ChatController } from '../../../../shared/remote-chat/client/controller';
import type { DownloadTask } from './types';
import { saveImage } from '../chat/saveImage';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import Storage from 'expo-sqlite/kv-store';

const { fs } = ReactNativeBlobUtil;
const DIRECTORY = `${fs.dirs.DocumentDir}/preview-downloads`;

/** iOS uses the same bounded range-transfer fallback as its ordinary file downloads.
 * Android's native binary receiver is deliberately not exposed as an iOS capability.
 */
class IosPreviewBackend {
  private tasks: DownloadTask[] = [];
  private listeners = new Set<() => void>();
  private initialization?: Promise<void>;
  private active = new Set<string>();
  private writes = Promise.resolve();
  private readonly directory: string;
  private readonly index: string;
  constructor(public controller: ChatController, private readonly identity: { owner: string; deviceId: string }) {
    const key = bytesToHex(sha256(utf8ToBytes(JSON.stringify(identity))));
    this.directory = `${DIRECTORY}/${key}`;
    this.index = `preview-downloads:${key}`;
  }
  private file(id: string) {
    if (!/^[a-f\d-]{36}$/i.test(id)) throw new Error('预览已失效，请重试。');
    return `${this.directory}/${id}.part`;
  }
  snapshot = () => this.tasks;
  error = () => '';
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  connection = () => ({ ...this.identity, deviceName: '', ready: this.controller.snapshot().ready });
  initialize = () => this.initialization ??= (async () => {
    if (!await fs.exists(this.directory)) await fs.mkdir(this.directory);
    const saved = await Storage.getItem(this.index);
    if (saved) {
      this.tasks = (JSON.parse(saved) as DownloadTask[])
        .map(task => ({ ...task, status: task.status === 'completed' ? 'completed' : 'paused' }));
    }
  })();
  private persist() {
    const json = JSON.stringify(this.tasks);
    const saved = this.writes.then(() => Storage.setItem(this.index, json));
    this.writes = saved.catch(() => { /* Each caller handles its own failed checkpoint. */ });
    this.listeners.forEach(listener => listener());
    return saved;
  }
  enqueue = async (source: PreviewSource) => {
    const task: DownloadTask = { id: randomUUID(), source, status: 'queued', received: 0,
      size: 0, createdAt: Date.now(), message: '', name: 'preview' };
    this.tasks.push(task); await this.persist(); this.schedule(); return task.id;
  };
  resume = async (id: string) => {
    const task = this.tasks.find(value => value.id === id);
    if (!task || this.active.has(id)) return;
    task.status = 'queued'; task.message = ''; await this.persist(); this.schedule();
  };
  remove = async (id: string) => {
    if (this.active.has(id)) return;
    if (await fs.exists(this.file(id))) await fs.unlink(this.file(id));
    this.tasks = this.tasks.filter(task => task.id !== id); await this.persist();
  };
  text = (task: DownloadTask) => fs.readFile(this.file(task.id), 'utf8');
  image = async (task: DownloadTask) => {
    if (!await fs.exists(this.file(task.id))) throw new Error('预览缓存已清理，请重试。');
    return `file://${this.file(task.id)}`;
  };
  save = async (task: DownloadTask) => { await saveImage(await this.image(task), task.mimeType); };
  private schedule() {
    for (const task of this.tasks) {
      if (this.active.size >= 2) return;
      if (task.status !== 'queued' || this.active.has(task.id) || task.source.owner !== this.identity.owner
        || task.source.deviceId !== this.identity.deviceId) continue;
      this.active.add(task.id);
      void this.run(task).finally(() => { this.active.delete(task.id); this.schedule(); });
    }
  }
  private async run(task: DownloadTask) {
    const client = this.controller.downloads;
    let remoteId: string | undefined;
    try {
      const info = await client.open({ ...task.source, transferId: task.id });
      remoteId = info.id; validateFileInfo(info);
      const exists = await fs.exists(this.file(task.id));
      const resume = exists && task.size === info.size && task.revision === info.revision && !!info.revision;
      if (!resume) { task.received = 0; await fs.writeFile(this.file(task.id), '', 'base64'); }
      else if (Number((await fs.stat(this.file(task.id))).size) !== task.received) {
        task.received = 0; await fs.writeFile(this.file(task.id), '', 'base64');
      }
      Object.assign(task, { size: info.size, revision: info.revision, mimeType: info.mimeType, name: info.name,
        status: 'downloading' });
      await this.persist();
      await transferFileChunks({ client, threadId: task.id, info,
        signal: new AbortController().signal, offset: task.received,
        write: async (chunk, received) => {
          await fs.appendFile(this.file(task.id), chunk.data, 'base64'); task.received = received; await this.persist();
        } });
      task.status = 'completed'; await this.persist();
    } catch {
      task.status = 'paused'; task.message = '加载中断，重新打开即可继续。';
      await this.persist().catch(() => console.warn('Could not checkpoint preview download.'));
    } finally {
      if (remoteId) await client.close(task.id, remoteId)
        .catch(() => console.warn('Remote preview handle will expire.'));
    }
  }
}

const backends = new Map<string, IosPreviewBackend>();
export function createIosPreviewDownloads(controller: ChatController, identity: { owner: string; deviceId: string }) {
  const key = JSON.stringify(identity);
  const backend = backends.get(key) ?? new IosPreviewBackend(controller, identity);
  backend.controller = controller;
  backends.set(key, backend);
  return new PreviewDownloads(backend, identity);
}
