import { DownloadPolicyError } from '../../../../shared/remote-chat/policy';
import { DownloadCancelled } from '../../../../shared/remote-chat/fileDownload';
import { BulkError } from '../../../../shared/remote-chat/bulkLimits';
import { saveDownload } from './saveDownload';
import type { AuthSession } from '../types';
import { deleteDownload, listDownloads, storeDownload } from './storage';
import { transferDownload } from './transfer';
import type { DownloadConnection, DownloadSource, DownloadTask } from './types';

const MAX_ACTIVE_DOWNLOADS = 2;
const MAX_DOWNLOAD_RECORDS = 500;
export const downloadOwner = (session: Pick<AuthSession, 'baseUrl' | 'email'>) =>
  JSON.stringify([session.baseUrl, session.email.toLowerCase()]);

export class WebDownloadManager {
  private tasks: DownloadTask[] = [];
  private listeners = new Set<() => void>();
  private current?: DownloadConnection;
  private initialization?: Promise<void>;
  private failure = '';
  private flights = new Map<string, { controller: AbortController; done: Promise<void> }>();
  snapshot = () => this.tasks;
  connection = () => this.current;
  error = () => this.failure;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit = () => { this.listeners.forEach(listener => listener()); };
  private update = (task: DownloadTask) => {
    this.tasks = this.tasks.map(current => current.id === task.id ? task : current);
    this.emit();
  };
  initialize = () => this.initialization ??= listDownloads().then(tasks => {
    this.tasks = tasks.map(task => ({ ...task, bytesPerSecond: undefined,
      status: ['queued', 'preparing', 'downloading', 'verifying'].includes(task.status) ? 'paused'
        : task.status === 'saving' ? 'ready' : task.status }));
    this.emit();
  }).catch(() => {
    this.failure = '无法读取下载记录，请检查浏览器存储空间后重试。';
    this.emit();
  });

  bind(connection: DownloadConnection) {
    this.current = connection;
    for (const task of this.tasks) {
      if (!this.connected(task)) this.flights.get(task.id)?.controller.abort();
    }
    this.emit();
    this.schedule();
  }
  unbind(client: DownloadConnection['files']) {
    if (this.current?.files !== client) return;
    this.current = undefined;
    this.flights.forEach(flight => flight.controller.abort());
    this.emit();
  }
  private connected(task: DownloadTask) {
    return this.current?.ready && this.current.owner === task.source.owner
      && this.current.deviceId === task.source.deviceId;
  }
  async enqueue(source: DownloadSource) {
    await this.initialize();
    if (this.failure) throw new Error(this.failure);
    const existing = this.tasks.find(task => task.source.owner === source.owner
      && task.source.deviceId === source.deviceId && task.source.path === source.path
      && task.source.scope === source.scope && task.source.threadId === source.threadId
      && task.source.cwd === source.cwd
      && ['queued', 'preparing', 'downloading', 'verifying', 'saving', 'paused'].includes(task.status));
    if (existing) { await this.resume(existing.id); return existing.id; }
    if (this.tasks.length >= MAX_DOWNLOAD_RECORDS) throw new Error('下载记录已满，请删除不再需要的记录后重试。');
    const task: DownloadTask = { id: crypto.randomUUID(), source,
      name: source.path.split(/[\\/]/).pop() || 'download', status: 'queued',
      received: 0, size: 0, createdAt: Date.now(), message: '' };
    await storeDownload(task);
    this.tasks = [...this.tasks, task];
    this.emit(); this.schedule();
    return task.id;
  }
  async pause(id: string) {
    const flight = this.flights.get(id);
    if (flight) { flight.controller.abort(); await flight.done; return; }
    const task = this.tasks.find(task => task.id === id);
    if (task && task.status === 'queued') {
      const paused: DownloadTask = { ...task, status: 'paused' };
      // Remove it from scheduling before yielding to storage or a finishing sibling download.
      this.update(paused);
      await storeDownload(paused);
    }
  }
  async resume(id: string) {
    const task = this.tasks.find(task => task.id === id);
    if (!task || this.flights.has(id) || ['completed', 'ready', 'saving'].includes(task.status)) return;
    await this.persist({ ...task, status: 'queued', message: '' });
    this.schedule();
  }
  async remove(id: string) {
    await this.pause(id);
    await deleteDownload(id);
    this.tasks = this.tasks.filter(task => task.id !== id);
    this.emit();
  }
  async save(id: string) {
    const task = this.tasks.find(task => task.id === id);
    if (!task || !['completed', 'ready'].includes(task.status)) return;
    // Invoke the picker in the click stack before an IndexedDB await consumes user activation.
    const saving = saveDownload(task, () => undefined);
    this.update({ ...task, status: 'saving' });
    try {
      const confirmed = await saving;
      await this.persist({ ...task, status: confirmed ? 'completed' : 'ready',
        message: confirmed ? '已保存到设备' : '已开始保存，请在浏览器下载列表中确认。' });
    } catch (error) {
      const invalid = error instanceof BulkError && error.code === 'INTEGRITY_FAILED';
      await this.persist({ ...task, status: invalid ? 'failed' : 'ready', verified: invalid ? false : task.verified,
        message: invalid ? error.message : error instanceof DownloadCancelled ? ''
        : '保存未完成，文件仍已就绪，可再次保存。' });
      if (!(error instanceof DownloadCancelled)) throw error;
    }
  }
  private async persist(task: DownloadTask) {
    await storeDownload(task);
    this.update(task);
  }
  private schedule() {
    for (const task of this.tasks) {
      if (this.flights.size >= MAX_ACTIVE_DOWNLOADS) return;
      if (task.status !== 'queued' || this.flights.has(task.id) || !this.connected(task) || !this.current) continue;
      const controller = new AbortController();
      const client = this.current.client;
      const done = Promise.resolve().then(() => this.run(task, client, controller.signal)).finally(() => {
        this.flights.delete(task.id); this.schedule();
      });
      this.flights.set(task.id, { controller, done });
    }
  }
  private async run(task: DownloadTask, client: DownloadConnection['client'], signal: AbortSignal) {
    try {
      await this.persist({ ...task, status: 'downloading' });
      await transferDownload({ task, client, signal, update: value => { task = value; this.update(value); } });
      await this.persist({ ...task, status: 'ready', bytesPerSecond: undefined });
    } catch (error) {
      const paused = signal.aborted || (error instanceof BulkError
        && ['PATH_UNAVAILABLE', 'EPOCH_EXPIRED'].includes(error.code));
      task = { ...task, status: paused ? 'paused' : 'failed', bytesPerSecond: undefined,
        message: signal.aborted ? '' : error instanceof DownloadPolicyError || error instanceof BulkError ? error.message
          : '下载未完成，请检查连接和存储空间后重试。' };
      this.update(task);
      await storeDownload(task).catch(() => {
        this.failure = '无法保存下载进度，请检查浏览器存储空间。'; this.emit();
      });
    }
  }
}

export const downloadManager = new WebDownloadManager();
