import type { FileInfo, FileRead, FileChunk } from './fileDownload';
import type { ProjectFilesResponse } from './projectFiles';

export interface DownloadLocation {
  scope: 'project' | 'computer';
  threadId?: string;
  cwd?: string;
}
export interface DownloadOpen extends DownloadLocation {
  transferId: string;
  path: string;
}
export interface DownloadBrowse extends DownloadLocation { directory: string }
export interface DownloadClient {
  bulk?: import('./bulkControl').BulkClient;
  open: (options: DownloadOpen) => Promise<FileInfo>;
  browse: (options: DownloadBrowse) => Promise<ProjectFilesResponse>;
  read: (options: FileRead) => Promise<FileChunk>;
  close: (transferId: string, id: string) => Promise<unknown>;
}
