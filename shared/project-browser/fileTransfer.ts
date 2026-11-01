import { fromByteArray } from 'base64-js';
import { utf8ToBytes } from '@noble/hashes/utils';
import { projectRequestToken } from './requestToken';
import { PROJECT_FILE_CHUNK_BYTES, type ProjectBrowserRequest, type ProjectDocument,
  type ProjectFileSave, type ProjectFileRead } from './protocol';

type Request = <T>(request: ProjectBrowserRequest) => Promise<T>;

/** New hosts return a bounded text window; older hosts require an update for large files. */
export async function readProjectDocument(request: Request, target: ProjectFileRead,
  signal?: AbortSignal, boundDraft = true): Promise<ProjectDocument> {
  const window = target.window ?? { token: projectRequestToken(), open: true };
  const release = () => request({ operation: 'projectFileRead', ...target,
    window: { token: window.token, cancel: true } }).catch(() => {
    console.warn('Project view cleanup deferred until session expiry');
  });
  const cancel = () => { void release(); };
  signal?.throwIfAborted();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const document = await request<ProjectDocument>({ operation: 'projectFileRead', ...target, window });
    if (signal?.aborted) { await release(); signal.throwIfAborted(); }
    if (document.chunked) throw new Error('client.projectBrowser.windowHostUpdate');
    return { ...document, bounded: document.bounded ?? boundDraft };
  } finally { signal?.removeEventListener('abort', cancel); }
}

/** Encode bounded packets even when a legacy caller supplies an existing large draft. */
function* encodedChunks(text: string) {
  const characters = PROJECT_FILE_CHUNK_BYTES / 4;
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + characters);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    yield utf8ToBytes(text.slice(start, end));
    start = end;
  }
}

/** The host stages chunks and atomically replaces the file after checking its original revision. */
export async function saveProjectDocument(request: Request, target: ProjectFileSave): Promise<ProjectDocument> {
  let size = 0;
  for (const bytes of encodedChunks(target.text)) size += bytes.length;
  if (target.window || size <= PROJECT_FILE_CHUNK_BYTES) {
    if (target.window && size > PROJECT_FILE_CHUNK_BYTES) throw new Error('client.projectBrowser.windowEditLimit');
    return { ...await request<ProjectDocument>({ operation: 'projectFileWrite', ...target }), bounded: true };
  }
  const token = projectRequestToken();
  const base = { operation: 'projectFileWrite' as const, cwd: target.cwd, path: target.path, revision: target.revision };
  let finished = false;
  let offset = 0;
  try {
    for (const bytes of encodedChunks(target.text)) {
      const finish = offset + bytes.length === size;
      const reply = await request<ProjectDocument>({ ...base, upload: {
        token, offset, size, data: fromByteArray(bytes), finish,
      } });
      if (finish) { finished = true; return { ...reply, text: target.text, chunked: undefined }; }
      offset += bytes.length;
    }
    throw new Error('client.projectBrowser.unableToSaveCheckThatTheFileIsWritableAnd');
  } finally {
    if (!finished) await request({ ...base, upload: { token, offset: 0, size, data: '', cancel: true } })
      .catch(() => console.warn('Project upload cleanup deferred until session expiry'));
  }
}
