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
  status: 'queued' | 'downloading' | 'paused' | 'completed' | 'failed';
  received: number;
  size: number;
  bytesPerSecond?: number;
  createdAt: number;
  message: string;
  uri?: string;
  mimeType?: string;
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
  operation: 'open' | 'read' | 'close';
  remoteId: string;
  offset: number;
  length: number;
}
export interface DownloadNative {
  list: () => Promise<string>;
  enqueue: (source: string) => Promise<string>;
  pause: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  delete: (id: string) => Promise<void>;
  connection: (owner: string, deviceId: string, windowSize: number) => Promise<void>;
  accept: (id: string, result: string | null, failed: boolean) => Promise<boolean>;
}
