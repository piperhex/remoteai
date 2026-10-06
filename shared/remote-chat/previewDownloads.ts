import type { DownloadLocation, PreviewKind } from './downloads';
import type { TextPreview } from './textPreview';

export interface PreviewSource extends DownloadLocation {
  owner: string; deviceId: string; deviceName: string; path: string; preview?: PreviewKind;
}
export interface PreviewTask {
  id: string; source: PreviewSource; status: string; size: number; createdAt: number; message: string;
  exported?: boolean;
}
export interface PreviewAdapter {
  image: (threadId: string, source: string, original: boolean) => Promise<string>;
  text: (threadId: string, path: string) => Promise<TextPreview>;
  saveImage: (url: string) => Promise<void>;
  dispose: () => void;
}
export interface PreviewBackend<T extends PreviewTask> {
  initialize: () => Promise<void>;
  snapshot: () => readonly T[];
  subscribe: (listener: () => void) => () => void;
  connection: () => { owner: string; deviceId: string; deviceName: string; ready: boolean } | undefined;
  error: () => string;
  enqueue: (source: PreviewSource) => Promise<string>;
  resume: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  image: (task: T) => Promise<string>;
  text: (task: T) => Promise<string>;
  save: (task: T) => Promise<void>;
  release?: (id: string) => void;
}

const CACHE_AGE_MS = 5 * 60_000;
const CACHE_BYTES = 128 * 1024 * 1024;
const CACHE_RECORDS = 128;
const PREPARE_TIMEOUT_MS = 15 * 60_000;
const complete = (task: PreviewTask) => ['ready', 'completed'].includes(task.status);
const active = (task: PreviewTask) => ['queued', 'preparing', 'downloading', 'verifying', 'saving'].includes(task.status);
const sourceKey = (source: PreviewSource) => JSON.stringify([
  source.owner, source.deviceId, source.threadId, source.path, source.preview,
]);

/** Preview work uses the manager's existing queue, persisted checkpoints and verification.
 * Only explicit save actions export files. Account/device identity is part of every cache lookup.
 */
export class PreviewDownloads<T extends PreviewTask> implements PreviewAdapter {
  private readonly pending = new Map<string, Promise<T>>();
  private readonly images = new Map<string, T>();
  private readonly saving = new Set<string>();
  private readonly waiting = new Set<() => void>();
  private disposed = false;
  private generation = 0;
  constructor(private readonly backend: PreviewBackend<T>,
    private readonly identity: { owner: string; deviceId: string }) {}

  private connected() {
    const connection = this.backend.connection();
    return connection?.ready && connection.owner === this.identity.owner
      && connection.deviceId === this.identity.deviceId;
  }

  private wait<R>(read: () => R | undefined, timeout = PREPARE_TIMEOUT_MS): Promise<R> {
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      const finish = (error?: Error, value?: R) => {
        clearTimeout(timer); unsubscribe(); this.waiting.delete(cancel);
        if (error) reject(error); else resolve(value!);
      };
      const cancel = () => finish(new Error('预览已关闭，请重新打开。'));
      const timer = setTimeout(() => finish(new Error('加载超时，请检查连接后重试。')), timeout);
      const check = () => {
        try {
          if (this.disposed) { cancel(); return; }
          const value = read();
          if (value !== undefined) finish(undefined, value);
          else if (this.backend.error()) finish(new Error(this.backend.error()));
        } catch (error) { finish(error instanceof Error ? error : new Error('加载失败，请重试。')); }
      };
      this.waiting.add(cancel); unsubscribe = this.backend.subscribe(check); check();
    });
  }

  private load(threadId: string, path: string, preview: PreviewKind): Promise<T> {
    this.disposed = false;
    const source: PreviewSource = { ...this.identity, deviceName: this.backend.connection()?.deviceName ?? '',
      scope: 'project', threadId, path, preview };
    const key = sourceKey(source);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const request = this.obtain(source, this.generation).finally(() => {
      if (this.pending.get(key) === request) this.pending.delete(key);
    });
    this.pending.set(key, request);
    return request;
  }

  private async obtain(source: PreviewSource, generation: number) {
    await this.backend.initialize();
    if (this.disposed || generation !== this.generation) throw new Error('预览已关闭，请重新打开。');
    const candidates = this.backend.snapshot().filter(task => sourceKey(task.source) === sourceKey(source));
    const cached = candidates.filter(complete).sort((a, b) => b.createdAt - a.createdAt)[0];
    // Reopening text online reads a fresh snapshot. Images have a short, explicit cache lifetime.
    if (cached && (!this.connected() || (source.preview !== 'text' && Date.now() - cached.createdAt < CACHE_AGE_MS))) {
      return cached;
    }
    await this.wait(() => this.connected() || undefined, 5000);
    if (generation !== this.generation) throw new Error('预览已关闭，请重新打开。');
    const unfinished = candidates.find(task => !complete(task));
    let id: string;
    if (unfinished) { id = unfinished.id; await this.backend.resume(id); }
    else { await this.prune(); id = await this.backend.enqueue(source); }
    return this.wait(() => {
      const task = this.backend.snapshot().find(value => value.id === id);
      if (!task) throw new Error('预览缓存已清理，请重试。');
      if (complete(task)) return task;
      if (!active(task)) throw new Error(task.message || '加载中断，重新打开即可继续。');
      return undefined;
    });
  }

  private async prune() {
    const tasks = this.backend.snapshot().filter(task => task.source.preview && !task.exported
      && task.source.owner === this.identity.owner).sort((a, b) => a.createdAt - b.createdAt);
    let bytes = tasks.reduce((sum, task) => sum + task.size, 0);
    let count = tasks.length;
    for (const task of tasks) {
      if (count < CACHE_RECORDS && bytes < CACHE_BYTES) break;
      if (active(task) || this.pending.has(sourceKey(task.source)) || this.saving.has(task.id)) continue;
      await this.backend.remove(task.id);
      this.backend.release?.(task.id);
      for (const [url, value] of this.images) if (value.id === task.id) this.images.delete(url);
      count--; bytes -= task.size;
    }
  }

  image = async (threadId: string, path: string, original: boolean) => {
    const task = await this.load(threadId, path, original ? 'image' : 'thumbnail');
    const url = await this.read(task, () => this.backend.image(task));
    if (original) this.images.set(url, task);
    return url;
  };
  text = async (threadId: string, path: string): Promise<TextPreview> => {
    const task = await this.load(threadId, path, 'text');
    return { path, text: await this.read(task, () => this.backend.text(task)) };
  };
  private async read(task: T, read: () => Promise<string>) {
    try { return await read(); }
    catch (error) {
      // Missing or damaged persisted content must not trap every retry in the same broken cache entry.
      await this.backend.remove(task.id);
      this.backend.release?.(task.id);
      throw error;
    }
  }
  saveImage = async (url: string) => {
    const task = this.images.get(url);
    if (!task || task.source.preview !== 'image') throw new Error('请重新加载原图后保存。');
    this.saving.add(task.id);
    try { await this.backend.save(task); }
    finally { this.saving.delete(task.id); }
  };
  dispose = () => {
    this.disposed = true;
    this.generation++;
    this.waiting.forEach(cancel => cancel());
    this.pending.clear();
    this.images.clear();
  };
}
