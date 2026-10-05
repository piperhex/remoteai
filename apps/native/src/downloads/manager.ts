import { t } from '../i18n';
import { DeviceEventEmitter, NativeModules, PermissionsAndroid, Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import type { AuthSession } from '../types';
import type { DownloadConnection, DownloadNative, DownloadRequest, DownloadSource, DownloadTask } from './types';
import { forwardDownloadRequest } from './transport';

export const downloadOwner = (session: AuthSession) => JSON.stringify([session.baseUrl, session.email]);
const native: DownloadNative | undefined = NativeModules.FileDownloads;
let tasks: DownloadTask[] = [];
let connection: DownloadConnection | undefined;
let error = '';
let initialized: Promise<void> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const requireNative = () => {
  if (!native) throw new Error(t("请安装支持下载管理的新版 Android 应用。"));
  return native;
};

export const downloadManager = {
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  snapshot: () => tasks,
  connection: () => connection,
  error: () => error,
  initialize() {
    if (initialized) return initialized;
    initialized = Promise.resolve().then(async () => {
      const bridge = requireNative();
      const changed = DeviceEventEmitter.addListener('downloadTasksChanged', (json: string) => {
        tasks = JSON.parse(json) as DownloadTask[]; emit();
      });
      const requests = DeviceEventEmitter.addListener('downloadRequest', (json: string) => {
        const request = JSON.parse(json) as DownloadRequest;
        const current = connection;
        const client = current?.owner === request.source.owner && current.deviceId === request.source.deviceId
          ? current.client : undefined;
        void forwardDownloadRequest({ request, client, native: bridge })
          .catch(() => { error = t("下载暂时中断，请稍后继续。"); emit(); });
      });
      try { tasks = JSON.parse(await bridge.list()) as DownloadTask[]; error = ''; emit(); }
      catch (cause) { changed.remove(); requests.remove(); throw cause; }
    }).catch(cause => {
      initialized = undefined;
      error = cause instanceof Error ? cause.message : t("暂时无法读取下载记录。"); emit();
    });
    return initialized;
  },
  bind(value: DownloadConnection) {
    const previous = connection;
    const sameSource = previous?.files === value.files && previous.owner === value.owner;
    if (sameSource && previous.ready === value.ready && previous.mode === value.mode
      && previous.windowSize === value.windowSize
      && previous.threadId === value.threadId
      && previous.cwd === value.cwd && previous.deviceName === value.deviceName) return;
    connection = value; emit();
    if (sameSource && previous.ready === value.ready && previous.windowSize === value.windowSize) return;
    void this.initialize().then(() => {
      if (connection?.files === value.files && connection.ready === value.ready
        && connection.windowSize === value.windowSize) {
        return native?.connection(value.owner, value.deviceId, value.ready ? value.windowSize : 0);
      }
    })
      .catch(() => { error = t("暂时无法连接下载管理。"); emit(); });
  },
  unbind(files: DownloadConnection['files']) {
    if (connection?.files !== files) return;
    const previous = connection;
    // Pause before discarding the source. A new device must never receive an old device's read requests.
    connection = undefined; emit();
    void native?.connection(previous.owner, previous.deviceId, 0)
      .catch(() => console.warn('Could not checkpoint disconnected downloads.'));
  },
  async enqueue(source: DownloadSource) {
    await this.initialize();
    if (!connection?.ready || connection.owner !== source.owner || connection.deviceId !== source.deviceId) {
      throw new Error(t("请先连接这台电脑，再开始下载。"));
    }
    if (Platform.OS === 'android' && Number(Platform.Version) < 29) {
      const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
      if (permission !== PermissionsAndroid.RESULTS.GRANTED) throw new Error(t("允许保存文件后，即可开始下载。"));
    }
    return requireNative().enqueue(JSON.stringify(source));
  },
  pause: (id: string) => requireNative().pause(id),
  resume: (id: string) => requireNative().resume(id),
  delete: (id: string) => requireNative().delete(id),
  async open(task: DownloadTask) {
    if (!task.uri || task.status !== 'completed') return;
    const uri = task.uri.startsWith('file://') ? decodeURI(task.uri.slice(7)) : task.uri;
    await ReactNativeBlobUtil.android.actionViewIntent(uri, task.mimeType || 'application/octet-stream');
  },
};
