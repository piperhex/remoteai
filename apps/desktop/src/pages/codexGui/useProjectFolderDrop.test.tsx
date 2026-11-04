// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import type { DragDropEvent } from '@tauri-apps/api/webview';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { guiApi } from '../../../../../shared/conversation/api';
import { useProjectFolderDrop } from './useProjectFolderDrop';
import { droppedReferences } from './fileDrop';

const native = vi.hoisted(() => ({ desktop: true, listen: vi.fn(), cleanup: vi.fn() }));
vi.mock('../../api/backend', () => ({ get isDesktopApp() { return native.desktop; } }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent: native.listen }) }));
vi.mock('../../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn() } }));
vi.mock('./fileDrop', () => ({ droppedReferences: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
let receive: (event: { payload: DragDropEvent }) => void;
const choose = vi.fn();
const report = vi.fn();
function Fixture({ enabled = true, allowFileAttachments = false }: {
  enabled?: boolean; allowFileAttachments?: boolean;
}) {
  const target = useRef<HTMLDivElement>(null);
  const drop = useProjectFolderDrop({ target, enabled, allowFileAttachments, onFolder: choose, onError: report });
  return <div ref={target} data-dragging={drop.dragging} data-reading={drop.reading} />;
}
const render = (enabled = true) => act(async () => root.render(<Fixture enabled={enabled} />));
const emit = (payload: DragDropEvent) => act(async () => receive({ payload }));
const position = (x = 60, y = 80) => new PhysicalPosition(x, y);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  native.desktop = true;
  native.listen.mockImplementation(async handler => { receive = handler; return native.cleanup; });
  vi.mocked(guiApi.request).mockResolvedValue({ directory: 'C:/项目 空格' });
  container = document.createElement('div');
  root = createRoot(container);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 20, top: 30, right: 120, bottom: 130, width: 100, height: 100, x: 20, y: 30, toJSON: () => ({}),
  });
  Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('accounts for display scaling, highlights only the target, and accepts a validated directory', async () => {
  await render();
  await emit({ type: 'enter', paths: ['C:\\项目 空格'], position: position() });
  expect(container.firstElementChild?.getAttribute('data-dragging')).toBe('true');
  await emit({ type: 'over', position: position(300, 400) });
  expect(container.firstElementChild?.getAttribute('data-dragging')).toBe('false');
  await emit({ type: 'drop', paths: ['C:\\项目 空格'], position: position(300, 400) });
  expect(guiApi.request).not.toHaveBeenCalled();
  await emit({ type: 'drop', paths: ['C:\\项目 空格'], position: position() });
  expect(guiApi.request).toHaveBeenCalledWith({ operation: 'projectDirectories', directory: 'C:\\项目 空格' });
  expect(choose).toHaveBeenCalledWith('C:/项目 空格');
  expect(container.firstElementChild?.getAttribute('data-reading')).toBe('false');
});

it('rejects multiple folders and regular files without replacing the project', async () => {
  await render();
  await emit({ type: 'drop', paths: ['C:/one', 'C:/two'], position: position() });
  expect(guiApi.request).not.toHaveBeenCalled();
  expect(report.mock.calls[0][0].message).toBe('请一次拖入一个文件夹。');
  vi.mocked(guiApi.request).mockRejectedValueOnce(new Error('internal path or credential'));
  await emit({ type: 'drop', paths: ['C:/file.txt'], position: position() });
  expect(choose).not.toHaveBeenCalled();
  expect(report.mock.calls[1][0].message).toBe('无法使用此文件夹，请选择可访问的文件夹。');
});

it('leaves files as attachments and selects only a folder from mixed composer drops', async () => {
  await act(async () => root.render(<Fixture allowFileAttachments />));
  vi.mocked(droppedReferences).mockResolvedValueOnce([{ kind: 'file', name: 'notes.txt', path: 'C:/notes.txt' }]);
  await emit({ type: 'drop', paths: ['C:/notes.txt'], position: position() });
  expect(guiApi.request).not.toHaveBeenCalled();
  expect(report).not.toHaveBeenCalled();
  vi.mocked(droppedReferences).mockResolvedValueOnce([
    { kind: 'file', name: 'notes.txt', path: 'C:/notes.txt' },
    { kind: 'folder', name: 'project', path: 'C:/project' },
  ]);
  await emit({ type: 'drop', paths: ['C:/notes.txt', 'C:/project'], position: position() });
  expect(guiApi.request).toHaveBeenCalledWith({ operation: 'projectDirectories', directory: 'C:/project' });
  expect(choose).toHaveBeenCalledOnce();
});

it('coalesces drops during validation and ignores the result after switching away', async () => {
  let finish!: (result: { directory: string }) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render();
  await emit({ type: 'drop', paths: ['C:/one'], position: position() });
  expect(container.firstElementChild?.getAttribute('data-reading')).toBe('true');
  await emit({ type: 'drop', paths: ['C:/two'], position: position() });
  expect(guiApi.request).toHaveBeenCalledOnce();
  await render(false);
  await act(async () => finish({ directory: 'C:/one' }));
  expect(choose).not.toHaveBeenCalled();
  expect(native.cleanup).toHaveBeenCalledOnce();
});

it('clears highlighting on cancellation and removes listeners on unmount', async () => {
  await render();
  await emit({ type: 'over', position: position() });
  await emit({ type: 'leave' });
  expect(container.firstElementChild?.getAttribute('data-dragging')).toBe('false');
  await act(async () => root.render(null));
  expect(native.cleanup).toHaveBeenCalledOnce();
});

it('does not listen in browsers or while disabled', async () => {
  await render(false);
  expect(native.listen).not.toHaveBeenCalled();
  native.desktop = false;
  await render();
  expect(native.listen).not.toHaveBeenCalled();
});

it('cleans up a subscription that finishes after unmounting', async () => {
  let finish!: (cleanup: () => void) => void;
  native.listen.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render();
  await act(async () => root.render(null));
  await act(async () => finish(native.cleanup));
  expect(native.cleanup).toHaveBeenCalledOnce();
});
