import { expect, it, vi } from 'vitest';
import { projectRequestToken } from '../../../../shared/project-browser/requestToken';
import { windowRequest } from '../../../../shared/project-browser/windowRequest';
import { readProjectDocument, saveProjectDocument } from '../../../../shared/project-browser/fileTransfer';
import { PROJECT_FILE_CHUNK_BYTES, type ProjectBrowserRequest } from '../../../../shared/project-browser/protocol';

const target = { cwd: '/project', path: '/project/large.ts' };

it('creates valid unique view tokens without the secure-context UUID API', () => {
  const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  vi.stubGlobal('crypto', { getRandomValues });
  try {
    const tokens = Array.from({ length: 64 }, projectRequestToken);
    expect(new Set(tokens).size).toBe(tokens.length);
    for (const token of tokens) {
      expect(token).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
      expect(windowRequest({ token, open: true })?.token).toBe(token);
    }
  } finally { vi.unstubAllGlobals(); }
});

it('loads only the requested window even when the file reports a terabyte', async () => {
  const calls: ProjectBrowserRequest[] = [];
  const request = async <T,>(input: ProjectBrowserRequest): Promise<T> => {
    calls.push(input);
    if (input.operation !== 'projectFileRead' || !input.window) throw new Error('expected window');
    return { ...target, kind: 'text', size: 1024 ** 4, text: '中文🙂\r\n', revision: 'one',
      readOnly: false, window: { ...input.window, offset: 0, end: 12, previous: 0 } } as T;
  };
  expect((await readProjectDocument(request, target)).text).toBe('中文🙂\r\n');
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ window: { open: true } });
});

it('rejects legacy large-file replies without allocating or downloading the complete file', async () => {
  let calls = 0;
  const request = async <T,>(): Promise<T> => {
    calls += 1;
    return { ...target, kind: 'text', size: 1024 ** 4, chunked: true } as T;
  };
  await expect(readProjectDocument(request, target)).rejects.toThrow('windowHostUpdate');
  expect(calls).toBe(1);
});

it('cancels a pending view and discards a late response', async () => {
  const abort = new AbortController();
  let finish!: (value: object) => void;
  let cancellations = 0;
  const request = async <T,>(input: ProjectBrowserRequest): Promise<T> => {
    if (input.operation === 'projectFileRead' && input.window?.cancel) {
      cancellations += 1; return null as T;
    }
    return new Promise<object>(resolve => { finish = resolve; }) as Promise<T>;
  };
  const pending = readProjectDocument(request, target, abort.signal);
  abort.abort(); finish({ ...target, text: 'late' });
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(cancellations).toBeGreaterThanOrEqual(1);
});

it('saves a page range without claiming its text is the entire file', async () => {
  const window = { token: 'view', offset: 800, end: 950, previous: 0 };
  let sent: ProjectBrowserRequest | undefined;
  const request = async <T,>(input: ProjectBrowserRequest): Promise<T> => {
    sent = input; return { ...target, text: 'edited', size: 1024 ** 3, window } as T;
  };
  const saved = await saveProjectDocument(request, { ...target, text: 'edited', revision: 'one', window });
  expect(sent).toMatchObject({ window, text: 'edited', revision: 'one' });
  expect(saved.window).toEqual(window);
  expect(saved.size).toBe(1024 ** 3);
});

it('chunks writes, returns the complete saved baseline and cancels failed staging', async () => {
  const text = '你好\r\n'.repeat(PROJECT_FILE_CHUNK_BYTES);
  const chunks: Buffer[] = [];
  let fail = false;
  let cancelled = false;
  const request = async <T,>(input: ProjectBrowserRequest): Promise<T> => {
    if (input.operation !== 'projectFileWrite' || !('upload' in input)) throw new Error('expected chunk');
    const upload = input.upload;
    if (upload.cancel) { cancelled = true; return null as T; }
    const bytes = Buffer.from(upload.data, 'base64');
    expect(bytes.length).toBeLessThanOrEqual(PROJECT_FILE_CHUNK_BYTES);
    if (fail) throw new Error('disconnected');
    chunks.push(bytes);
    return { ...target, kind: 'text', readOnly: false, revision: 'saved', chunked: true } as T;
  };
  expect((await saveProjectDocument(request, { ...target, text, revision: 'original' })).text).toBe(text);
  expect(Buffer.concat(chunks).toString()).toBe(text);
  fail = true;
  await expect(saveProjectDocument(request, { ...target, text, revision: 'original' })).rejects.toThrow('disconnected');
  expect(cancelled).toBe(true);
});
