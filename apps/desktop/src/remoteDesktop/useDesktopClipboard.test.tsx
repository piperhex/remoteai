// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDesktopClipboard } from '../../../../shared/remote-desktop/views/useDesktopClipboard';
import { ClipboardReadUnavailableError, type ClipboardContent } from '../../../../shared/remote-desktop/clipboard';

const text = (value: string): ClipboardContent => ({ format: 'text', text: value });
const clipboard = { read: vi.fn(), write: vi.fn(), copy: vi.fn(), paste: vi.fn() };
const localClipboard = { files: true, read: vi.fn(), write: vi.fn() };
let state: ReturnType<typeof useDesktopClipboard>;
let root: Root;
function Harness({ active = true, native = true, sync = true }) {
  state = useDesktopClipboard({ active, clipboard: { ...clipboard, syncEnabled: sync },
    localClipboard: native ? localClipboard : undefined });
  return null;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.resetAllMocks();
  clipboard.read.mockResolvedValue(text('remote')); clipboard.copy.mockResolvedValue(text('remote'));
  clipboard.write.mockResolvedValue(undefined);
  clipboard.paste.mockImplementation(async preferLocal => preferLocal ? 'revision-1' : undefined);
  localClipboard.read.mockResolvedValue(text('local')); localClipboard.write.mockResolvedValue(undefined);
  root = createRoot(document.createElement('div'));
  act(() => root.render(<Harness />));
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('disabling sync cancels a queued transfer and blocks late writes to the local clipboard', async () => {
  const reading = deferred<ClipboardContent>(); clipboard.copy.mockReturnValueOnce(reading.promise);
  await act(async () => { state.copy('copy'); state.pasteLocal(); });
  act(() => root.render(<Harness sync={false} />));
  await act(async () => reading.resolve(text('late private contents')));
  expect(localClipboard.write).not.toHaveBeenCalled(); expect(clipboard.write).not.toHaveBeenCalled();
  localClipboard.read.mockClear();
  await act(async () => state.pasteShortcut!());
  expect(localClipboard.read).not.toHaveBeenCalled(); expect(clipboard.paste).toHaveBeenLastCalledWith(false);
});

it('queues consecutive paste gestures without overlapping or losing transfers', async () => {
  const first = deferred<void>(); clipboard.write.mockImplementationOnce(() => first.promise);
  await act(async () => { state.pasteLocal(); state.pasteLocal(); });
  expect(clipboard.write).toHaveBeenCalledTimes(1); expect(state.busy).toBe(true);
  await act(async () => first.resolve());
  expect(clipboard.write).toHaveBeenCalledTimes(2); expect(state.busy).toBe(false);
});

it('discards queued work and late copy results after the viewer becomes inactive', async () => {
  const reading = deferred<ClipboardContent>(); clipboard.copy.mockReturnValueOnce(reading.promise);
  await act(async () => { state.copy('copy'); state.pasteLocal(); });
  act(() => root.render(<Harness active={false} />));
  await act(async () => reading.resolve(text('old session')));
  expect(localClipboard.write).not.toHaveBeenCalled(); expect(localClipboard.read).toHaveBeenCalledTimes(1);
  expect(clipboard.write).not.toHaveBeenCalled(); expect(state.status).toBe(''); expect(state.busy).toBe(false);
  act(() => root.render(<Harness />));
  await act(async () => state.pasteLocal());
  expect(clipboard.write).toHaveBeenCalledTimes(1);
});

it('keeps native file copies available for retry after a system clipboard write fails', async () => {
  const files: ClipboardContent = { format: 'files', files: [{ name: 'report.txt', data: 'YQ==' }] };
  clipboard.copy.mockResolvedValueOnce(files); localClipboard.write.mockRejectedValueOnce('clipboard locked');
  await act(async () => state.copy('copy'));
  expect(state.received).toEqual(files); expect(state.open).toBe(false); expect(state.needsSave).toBe(true);
  await act(async () => state.save());
  expect(localClipboard.write).toHaveBeenLastCalledWith(files);
  expect(state.status).toBe(''); expect(state.needsSave).toBe(false);
  expect(clipboard.copy).toHaveBeenCalledTimes(1);
});

it('uses the in-flight remote copy for an immediate browser paste, not stale event text', async () => {
  act(() => root.render(<Harness native={false} />));
  const reading = deferred<ClipboardContent>(); clipboard.copy.mockReturnValueOnce(reading.promise);
  await act(async () => { state.copy('copy'); state.paste({} as DataTransfer); });
  await act(async () => reading.resolve(text('fresh remote')));
  expect(clipboard.paste).toHaveBeenCalledWith(false); expect(clipboard.write).not.toHaveBeenCalled();
});

it('shows native errors and allows the next paste to proceed', async () => {
  localClipboard.read.mockRejectedValueOnce('暂不支持复制文件夹，请先压缩后再复制。');
  await act(async () => state.pasteLocal());
  expect(state.status).toContain('文件夹'); expect(state.busy).toBe(false);
  expect(state.open).toBe(false);
  await act(async () => state.pasteLocal());
  expect(clipboard.write).toHaveBeenCalledTimes(1);
});

it('completes regular copy and paste silently without opening the clipboard panel', async () => {
  await act(async () => state.copy('cut'));
  expect(localClipboard.write).toHaveBeenCalledWith(text('remote'));
  expect(state.status).toBe(''); expect(state.open).toBe(false);
  await act(async () => state.pasteLocal());
  expect(clipboard.write).toHaveBeenCalledWith(text('local'), true, expect.any(Function));
  expect(state.status).toBe(''); expect(state.open).toBe(false);
});

it('only shows progress for slow transfers and clears it on completion', async () => {
  vi.useFakeTimers();
  const reading = deferred<ClipboardContent>(); clipboard.copy.mockReturnValueOnce(reading.promise);
  await act(async () => state.copy('copy'));
  await act(async () => vi.advanceTimersByTimeAsync(799));
  expect(state.status).toBe('');
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(state.status).toBe('正在传输剪贴板…'); expect(state.open).toBe(false);
  await act(async () => reading.resolve(text('remote')));
  expect(state.status).toBe(''); expect(state.progress).toBeUndefined();
});

it('uses the fresh remote copy for native paste even when the local clipboard is locked', async () => {
  const reading = deferred<ClipboardContent>(); clipboard.copy.mockReturnValueOnce(reading.promise);
  localClipboard.write.mockRejectedValueOnce('clipboard locked');
  await act(async () => { state.copy('cut'); state.pasteShortcut!(); });
  await act(async () => reading.resolve(text('fresh remote')));
  expect(clipboard.paste).toHaveBeenCalledWith(false); expect(clipboard.write).not.toHaveBeenCalled();
  expect(state.open).toBe(false);
});

it('does not paste stale native data if the preceding remote copy fails', async () => {
  clipboard.copy.mockRejectedValueOnce(new Error('copy failed'));
  await act(async () => { state.copy('copy'); state.pasteShortcut!(); });
  expect(clipboard.write).not.toHaveBeenCalled(); expect(clipboard.paste).toHaveBeenCalledWith(false);
  expect(state.open).toBe(false);
});

it('keeps multiple browser files available without opening the download panel', async () => {
  act(() => root.render(<Harness native={false} />));
  clipboard.copy.mockResolvedValueOnce({ format: 'files', files: [
    { name: 'one.txt', data: 'YQ==' }, { name: 'two.txt', data: 'Yg==' },
  ] });
  await act(async () => state.copy('copy'));
  expect(state.open).toBe(false); expect(state.status).toContain('下载文件');
});

it('preserves remote paste after a completed copy fails to synchronize locally', async () => {
  localClipboard.write.mockRejectedValueOnce(new Error('denied'));
  await act(async () => state.copy('cut'));
  expect(state.busy).toBe(false);
  await act(async () => state.pasteShortcut!());
  expect(clipboard.paste).toHaveBeenCalledWith(false); expect(clipboard.write).not.toHaveBeenCalled();
});

it('preserves rich text and cut files on repeated remote-to-remote paste', async () => {
  const files: ClipboardContent = { format: 'files', files: [{ name: 'original.docx', data: 'YQ==' }] };
  clipboard.copy.mockResolvedValueOnce(files);
  localClipboard.write.mockImplementationOnce(async content => { localClipboard.read.mockResolvedValue(content); });
  await act(async () => state.copy('cut'));
  await act(async () => { state.pasteShortcut!(); state.pasteShortcut!(); });
  expect(clipboard.paste.mock.calls).toEqual([[false], [false]]);
  expect(clipboard.write).not.toHaveBeenCalled();
});

it('imports newly copied local content with the host revision guard', async () => {
  await act(async () => state.copy('copy'));
  localClipboard.read.mockResolvedValueOnce(text('new local'));
  await act(async () => state.pasteShortcut!());
  expect(clipboard.paste).toHaveBeenCalledWith(true);
  expect(clipboard.write).toHaveBeenCalledWith(text('new local'), true, expect.any(Function), 'revision-1');
});

it('does not upload stale local content when the host detects a remote context-menu copy', async () => {
  clipboard.paste.mockResolvedValueOnce(undefined);
  await act(async () => state.pasteShortcut!());
  expect(clipboard.paste).toHaveBeenCalledWith(true); expect(clipboard.write).not.toHaveBeenCalled();
  await act(async () => state.pasteShortcut!());
  expect(clipboard.paste).toHaveBeenLastCalledWith(false); expect(clipboard.write).not.toHaveBeenCalled();
});

it('allows native copy/paste for folders or hosts that disable clipboard sharing', async () => {
  clipboard.copy.mockResolvedValueOnce(undefined);
  await act(async () => state.copy('copy'));
  await act(async () => state.pasteShortcut!());
  expect(clipboard.paste).toHaveBeenCalledWith(false);
  expect(clipboard.write).not.toHaveBeenCalled(); expect(localClipboard.write).not.toHaveBeenCalled();
  expect(state.status).toBe('');
});

it('preserves native paste when reading the local clipboard is unavailable', async () => {
  localClipboard.read.mockRejectedValueOnce(new ClipboardReadUnavailableError('无法访问剪贴板，请重新复制后再试。'));
  await act(async () => state.pasteShortcut!());
  expect(clipboard.paste).toHaveBeenCalledWith(false); expect(clipboard.write).not.toHaveBeenCalled();
});

it.each(['剪贴板内容过大，请分批复制（每次最多 64 MB）。', '暂不支持复制文件夹，请先压缩后再复制。'])(
  'stops native paste when readable local content fails validation: %s', async error => {
    localClipboard.read.mockRejectedValueOnce(error);
    await act(async () => state.pasteShortcut!());
    expect(state.status).toBe(error);
    expect(clipboard.paste).not.toHaveBeenCalled();
    expect(clipboard.write).not.toHaveBeenCalled();
  },
);
