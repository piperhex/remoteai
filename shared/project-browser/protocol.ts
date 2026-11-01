import type { ProjectFilesResponse } from '../remote-chat/projectFiles';
import type { DownloadClient } from '../remote-chat/downloads';
import type { EntryChange, EntryRequest } from './entryActions';
import { readProjectDocument, saveProjectDocument } from './fileTransfer';

export const PROJECT_PLAIN_TEXT_THRESHOLD = 5 * 1024 * 1024;
export const PROJECT_FILE_CHUNK_BYTES = 256 * 1024;
export const PROJECT_SEARCH_QUERY_LIMIT = 256;

export interface ProjectFileTarget { cwd: string; path: string }
export interface ProjectFileWindow { token: string; offset: number; end: number; previous: number }
export interface ProjectWindowRequest { token: string; offset?: number; end?: number; open?: boolean; cancel?: boolean }
export interface ProjectFileRead extends ProjectFileTarget { window?: ProjectWindowRequest }
export interface ProjectFileSave extends ProjectFileRead { text: string; revision: string }
export interface ProjectBlameCommit { hash: string; author: string; time: number; timezone: string; summary: string }
export interface ProjectBlame {
  status: 'ready' | 'notRepository' | 'untracked' | 'changed' | 'unavailable';
  revision: string;
  commits: ProjectBlameCommit[];
  ranges: { start: number; count: number; commit: number | null }[];
}
export interface ProjectDocument {
  path: string;
  kind: 'text' | 'image' | 'binary' | 'large';
  size: number;
  text?: string;
  image?: string;
  revision: string;
  readOnly: boolean;
  chunked?: boolean;
  window?: ProjectFileWindow;
  /** The project file service bounds editable drafts; other hosts can retain their own policy. */
  bounded?: boolean;
}
export type ProjectBrowserRequest =
  | ({ operation: 'projectFiles'; directory?: string; query?: string; searchAllDirectories?: boolean }
    & Pick<ProjectFileTarget, 'cwd'>)
  | ({ operation: 'projectFileRead'; chunk?: { offset: number; length: number } } & ProjectFileRead)
  | ({ operation: 'projectFileBlame'; revision: string } & ProjectFileTarget)
  | ({ operation: 'projectEntryAction' } & EntryRequest)
  | ({ operation: 'projectFileWrite' } & ProjectFileSave)
  | ({ operation: 'projectFileWrite'; revision: string; upload: ProjectFileUpload } & ProjectFileTarget);

export interface ProjectFileUpload {
  token: string; offset: number; size: number; data: string; finish?: boolean; cancel?: boolean;
}

export interface ProjectBrowserClient {
  list: (cwd: string, directory?: string, query?: string) => Promise<ProjectFilesResponse>;
  read: (target: ProjectFileRead, signal?: AbortSignal) => Promise<ProjectDocument>;
  release?: (target: ProjectFileRead) => Promise<void>;
  save: (target: ProjectFileSave) => Promise<ProjectDocument>;
  mutate: (request: EntryRequest) => Promise<EntryChange>;
  blame?: (target: ProjectFileTarget & { revision: string }) => Promise<ProjectBlame>;
  transfer?: DownloadClient;
}

export function createProjectBrowserClient(request: <T>(request: ProjectBrowserRequest) => Promise<T>,
  transfer?: DownloadClient): ProjectBrowserClient {
  return {
    transfer,
    list: (cwd: string, directory?: string, query?: string) =>
      request<ProjectFilesResponse>({ operation: 'projectFiles', cwd, directory,
        ...(query === undefined ? {} : { query, searchAllDirectories: true }) }),
    read: (target, signal) => readProjectDocument(request, target, signal),
    release: async target => { if (target.window) await request({ operation: 'projectFileRead', ...target,
      window: { token: target.window.token, cancel: true } }); },
    blame: target => request<ProjectBlame>({ operation: 'projectFileBlame', ...target }),
    save: target => saveProjectDocument(request, target),
    mutate: (target: EntryRequest) => request<EntryChange>({ operation: 'projectEntryAction', ...target }),
  };
}
