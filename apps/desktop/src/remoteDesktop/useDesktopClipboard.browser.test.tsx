// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDesktopClipboard } from '../../../../shared/remote-desktop/views/useDesktopClipboard';
import { MAX_CLIPBOARD_BYTES, MAX_CLIPBOARD_FILES, type ClipboardContent }
  from '../../../../shared/remote-desktop/clipboard';

const clipboard = { read: vi.fn(), write: vi.fn(), copy: vi.fn(), paste: vi.fn() };
let state: ReturnType<typeof useDesktopClipboard>;
let root: Root;

function Harness() {
  state = useDesktopClipboard({ active: true, clipboard });
  return null;
}
function pasteData(files: File[] = [], text = '', html = ''): DataTransfer {
  return { files, items: [], getData: (type: string) => type === 'text/html' ? html : text } as unknown as DataTransfer;
}
function smallFile(name: string) {
  const file = new File(['a'], name, { type: 'text/plain' });
  // JSDOM's File lacks arrayBuffer; retain real file metadata and provide the standard byte reader.
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([97]).buffer });
  return file;
}
function unreadableBrowser(state: 'prompt' | 'denied' | 'unsupported') {
  const read = vi.fn(() => new Promise<ClipboardItem[]>(() => {}));
  const query = state === 'unsupported' ? undefined : vi.fn().mockResolvedValue({ state });
  vi.stubGlobal('navigator', { clipboard: { read }, permissions: query ? { query } : undefined });
  return read;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.resetAllMocks();
  clipboard.write.mockResolvedValue(undefined);
  clipboard.paste.mockImplementation(async preferLocal => preferLocal ? 'revision-1' : undefined);
  root = createRoot(document.createElement('div'));
  act(() => root.render(<Harness />));
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('rejects 33 small pasted files without pasting or replacing the old remote clipboard', async () => {
  const files = Array.from({ length: MAX_CLIPBOARD_FILES + 1 }, (_, index) => smallFile(`file-${index}.txt`));
  await act(async () => state.paste(pasteData(files)));
  expect(state.status).toContain('32 个文件');
  expect(state.busy).toBe(false);
  expect(clipboard.paste).not.toHaveBeenCalled();
  expect(clipboard.write).not.toHaveBeenCalled();
  await act(async () => state.paste(pasteData([], 'new local text')));
  expect(clipboard.paste).toHaveBeenCalledWith(true);
  expect(clipboard.write).toHaveBeenCalledWith(
    { format: 'text', text: 'new local text' }, true, expect.any(Function), 'revision-1',
  );
});

it('rejects pasted files whose combined size exceeds 64 MB before any remote paste', async () => {
  const files = [smallFile('one.txt'), smallFile('two.txt')];
  for (const file of files) Object.defineProperty(file, 'size', { value: MAX_CLIPBOARD_BYTES / 2 + 1 });
  await act(async () => state.paste(pasteData(files)));
  expect(state.status).toContain('64 MB');
  expect(state.busy).toBe(false);
  expect(clipboard.paste).not.toHaveBeenCalled();
  expect(clipboard.write).not.toHaveBeenCalled();
});

it('reports a corrupt pasted image without falling back to the old remote clipboard', async () => {
  const decode = vi.fn().mockRejectedValue(new DOMException('Cannot decode image', 'InvalidStateError'));
  vi.stubGlobal('createImageBitmap', decode);
  const image = new File(['invalid image bytes'], 'broken.png', { type: 'image/png' });
  await act(async () => state.paste(pasteData([image])));
  expect(decode).toHaveBeenCalledWith(image);
  expect(state.status).toBe('图片未能读取，请重新复制。');
  expect(state.busy).toBe(false);
  expect(clipboard.paste).not.toHaveBeenCalled();
  expect(clipboard.write).not.toHaveBeenCalled();
});

it.each(['too many files', 'corrupt image'])(
  'validates %s even when a preceding remote copy is still pending', async invalidContent => {
    let finishCopy!: (content: ClipboardContent) => void;
    clipboard.copy.mockImplementation(() => new Promise<ClipboardContent>(resolve => { finishCopy = resolve; }));
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('Corrupt image')));
    const files = invalidContent === 'too many files'
      ? Array.from({ length: MAX_CLIPBOARD_FILES + 1 }, (_, index) => smallFile(`file-${index}.txt`))
      : [new File(['invalid image bytes'], 'broken.png', { type: 'image/png' })];
    await act(async () => { state.copy('cut'); state.paste(pasteData(files)); });
    await act(async () => finishCopy({ format: 'text', text: 'remote cut content' }));
    expect(state.status).toContain(invalidContent === 'too many files' ? '32 个文件' : '图片未能读取');
    expect(clipboard.paste).not.toHaveBeenCalled();
    expect(clipboard.write).not.toHaveBeenCalled();
  },
);

it('stops an incomplete image paste instead of silently pasting remote content', async () => {
  await act(async () => state.paste(pasteData([], '', '<img src="data:image/png;base64,invalid!">')));
  expect(state.status).toBe("client.errors.someImagesCouldNotBePastedCopyThemSeparatelyOr");
  expect(clipboard.paste).not.toHaveBeenCalled();
  expect(clipboard.write).not.toHaveBeenCalled();
});

it('preserves remote paste when the browser supplies no readable local clipboard content', async () => {
  await act(async () => state.paste(pasteData()));
  expect(clipboard.paste).toHaveBeenCalledWith(false);
  expect(clipboard.write).not.toHaveBeenCalled();
  expect(state.status).toBe('');
});

it.each(['prompt', 'denied', 'unsupported'] as const)(
  'uploads selected files without a clipboard read or permission wait when access is %s', async permission => {
    const read = unreadableBrowser(permission);
    await act(async () => state.sendFiles([smallFile('selected.txt')]));
    expect(read).not.toHaveBeenCalled();
    expect(clipboard.write).toHaveBeenCalledWith(
      { format: 'files', files: [{ name: 'selected.txt', data: 'YQ==' }] }, true, expect.any(Function),
    );
    expect(state.status).toBe('');
    expect(state.busy).toBe(false);
  },
);

it('uploads selected files if an existing clipboard grant no longer permits reading', async () => {
  const read = vi.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
  vi.stubGlobal('navigator', { clipboard: { read },
    permissions: { query: vi.fn().mockResolvedValue({ state: 'granted' }) } });
  await act(async () => state.sendFiles([smallFile('selected.txt')]));
  expect(clipboard.write).toHaveBeenCalledTimes(1);
  expect(state.status).toBe('');
  expect(state.busy).toBe(false);
});

it('finishes the selected file upload even if an already authorized baseline read remains pending', async () => {
  vi.useFakeTimers();
  let completeBaseline!: (text: string) => void;
  const readText = vi.fn(() => new Promise<string>(resolve => { completeBaseline = resolve; }));
  vi.stubGlobal('navigator', { clipboard: { readText },
    permissions: { query: vi.fn().mockResolvedValue({ state: 'granted' }) } });
  await act(async () => state.sendFiles([smallFile('selected.txt')]));
  expect(clipboard.write).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(state.status).toBe('');
  expect(state.busy).toBe(false);
  await act(async () => completeBaseline('late local text'));
  await act(async () => state.paste(pasteData([], 'different local text')));
  expect(clipboard.paste).toHaveBeenCalledWith(false);
});
