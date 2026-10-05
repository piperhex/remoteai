import type { DownloadLocation, DownloadClient } from '../../../../shared/remote-chat/downloads';
import type { FileClient } from '../../../../shared/remote-chat/fileDownload';
import type { ConnectionMode } from '../../../../shared/remote-chat/protocol';

export interface DownloadSource extends DownloadLocation {
  owner: string;
  deviceId: string;
  deviceName: string;
  path: string;
}
export interface DownloadTask {
  id: string;
  source: DownloadSource;
  name: string;
  status: 'queued' | 'preparing' | 'downloading' | 'verifying' | 'saving' | 'paused' | 'completed' | 'failed';
  received: number;
  size: number;
  bytesPerSecond?: number;
  createdAt: number;
  message: string;
  uri?: string;
  mimeType?: string;
  readyToSave?: boolean;
  savedBytes?: number;
}
export interface DownloadConnection {
  owner: string;
  deviceId: string;
  deviceName: string;
  ready: boolean;
  mode: ConnectionMode;
  windowSize: number;
  threadId?: string;
  cwd?: string;
  client: DownloadClient;
  files: FileClient;
}
export interface DownloadRequest {
  requestId: string;
  taskId: string;
  source: DownloadSource;
  operation: 'open' | 'read' | 'close' | 'bulkRead' | 'bulkCancel' | 'cancelOpen';
  remoteId: string;
  offset: number;
  length: number;
  epoch?: string; manifestId?: string; block?: number; granted?: number; requestNumber?: number;
}
export interface DownloadNative {
  bulkBinaryAvailable?: boolean;
  manifestPage?: (id: string, page: string) => Promise<void>;
  invalidateBulk?: (owner: string, deviceId: string) => Promise<void>;
  list: () => Promise<string>;
  enqueue: (source: string) => Promise<string>;
  pause: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  delete: (id: string) => Promise<void>;
  connection: (owner: string, deviceId: string, windowSize: number) => Promise<void>;
  accept: (id: string, result: string | null, failed: boolean) => Promise<boolean>;
}
