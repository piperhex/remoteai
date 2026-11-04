// @vitest-environment jsdom
import { act, type ClipboardEvent, type KeyboardEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useComposerPaste } from '../../../../../../shared/remote-chat/views/useComposerPaste';

let root: Root;
let paste: ReturnType<typeof useComposerPaste>;
const addFiles = vi.fn<(files: File[]) => Promise<void>>();
const native = vi.fn<() => Promise<File[]>>();
const insertText = vi.fn();
const image = () => new File(['image'], 'screenshot.png', { type: 'image/png' });
function Fixture({ scope = 'one', active = true, browserOnly = false } = {}) {
  paste = useComposerPaste({ scope, active, busy: false, addFiles, insertText,
    readClipboardImages: browserOnly ? undefined : native });
  return null;
}
const render = (props = {}) => act(async () => root.render(<Fixture {...props} />));
const shortcut = () => paste.pasteKeyDown({ key: 'v', ctrlKey: true } as KeyboardEvent<HTMLTextAreaElement>);
function event(files: File[] = [], text = '', itemsOnly = false, html = '') {
  const value = { clipboardData: { files: itemsOnly ? [] : files,
    getData: (type: string) => type === 'text/html' ? html : text,
    items: files.map(file => ({ kind: 'file', getAsFile: () => file })) }, preventDefault: vi.fn() };
  paste.paste(value as unknown as ClipboardEvent<HTMLTextAreaElement>);
  return value;
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  native.mockReset().mockResolvedValue([]); addFiles.mockReset().mockResolvedValue(undefined);
  insertText.mockReset();
  root = createRoot(document.createElement('div')); await render();
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it('coalesces the native shortcut and paste event, using original file bytes once', async () => {
  let resolve!: (files: File[]) => void;
  native.mockReturnValue(new Promise(done => { resolve = done; }));
  const original = image();
  await act(async () => { shortcut(); event([image()]); });
  expect(paste.reading).toBe(true); expect(native).toHaveBeenCalledTimes(1);
  await act(async () => resolve([original]));
  expect(addFiles).toHaveBeenCalledExactlyOnceWith([original]); expect(paste.reading).toBe(false);
});

it('supports Explorer image copies when Windows emits no paste event', async () => {
  const original = image(); native.mockResolvedValue([original]);
  await act(async () => shortcut());
  expect(addFiles).toHaveBeenCalledExactlyOnceWith([original]);
});

it('falls back to screenshots from clipboard items when native access fails', async () => {
  native.mockRejectedValue(new Error('clipboard busy'));
  const screenshot = image();
  await act(async () => { shortcut(); event([screenshot], '', true); });
  expect(addFiles).toHaveBeenCalledExactlyOnceWith([screenshot]); expect(paste.error).toBe('');
});

it('leaves plain text paste untouched and suppresses irrelevant native errors', async () => {
  native.mockRejectedValue(new Error('clipboard busy'));
  await act(async () => { shortcut(); expect(event([], 'hello').preventDefault).not.toHaveBeenCalled(); });
  expect(addFiles).not.toHaveBeenCalled(); expect(paste.error).toBe('');
});

it.each([{ scope: 'two' }, { active: false }])('discards late clipboard reads after changing scope: %o', async props => {
  let resolve!: (files: File[]) => void;
  native.mockReturnValue(new Promise(done => { resolve = done; }));
  await act(async () => shortcut()); await render(props);
  await act(async () => resolve([image()]));
  expect(addFiles).not.toHaveBeenCalled(); expect(paste.reading).toBe(false);
});

it('keeps browser-only paste working without invoking a native command', async () => {
  await render({ browserOnly: true });
  const file = image(); await act(async () => event([file]));
  expect(addFiles).toHaveBeenCalledExactlyOnceWith([file]); expect(native).not.toHaveBeenCalled();
});

it('reports a failed native paste and allows retry', async () => {
  native.mockRejectedValueOnce(new Error('private path')).mockResolvedValue([image()]);
  await act(async () => shortcut()); expect(paste.error).toBe('图片粘贴失败，请重新复制后再试。');
  await act(async () => shortcut()); expect(addFiles).toHaveBeenCalledTimes(1); expect(paste.error).toBe('');
});

it('keeps QQ text and native images together, including when DOM provides no image files', async () => {
  const file = image(); native.mockResolvedValue([file]);
  await act(async () => { shortcut(); event([], '图片说明', false, '<img src="file:///C:/QQ/photo.png">'); });
  expect(insertText).toHaveBeenCalledExactlyOnceWith('图片说明', undefined);
  expect(addFiles).toHaveBeenCalledExactlyOnceWith([file]);
  expect(paste.error).toBe('');
});

it('pastes browser image files and their accompanying text together', async () => {
  await render({ browserOnly: true });
  const file = image();
  await act(async () => event([file], '图片说明', false, '<img src="cid:0">'));
  expect(insertText).toHaveBeenCalledExactlyOnceWith('图片说明', undefined);
  expect(addFiles).toHaveBeenCalledExactlyOnceWith([file]);
  expect(native).not.toHaveBeenCalled();
});

it('preserves text and reports browser-inaccessible QQ images', async () => {
  await render({ browserOnly: true });
  await act(async () => event([], '图片说明', false, '<img src="file:///C:/QQ/photo.png">'));
  expect(insertText).toHaveBeenCalledExactlyOnceWith('图片说明', undefined);
  expect(paste.error).toBe('部分图片未能粘贴，请单独复制图片，或保存后添加。');
});

it('turns large browser text into a file before inserting it into the textarea', async () => {
  await render({ browserOnly: true });
  await act(async () => {
    expect(event([], '正文'.repeat(10_000)).preventDefault).toHaveBeenCalledOnce();
  });
  expect(insertText).not.toHaveBeenCalled();
  expect(addFiles).toHaveBeenCalledOnce();
  const [file] = addFiles.mock.calls[0][0];
  expect(file.name).toMatch(/\.txt$/); expect(file.size).toBe(60_000);
});

it('retains the long text attachment alongside native images from the same paste', async () => {
  const file = image(); native.mockResolvedValue([file]);
  await act(async () => { shortcut(); event([], '正文'.repeat(10_000), false, '<img src="cid:0">'); });
  expect(insertText).not.toHaveBeenCalled();
  expect(addFiles).toHaveBeenCalledOnce();
  expect(addFiles.mock.calls[0][0][0]).toBe(file);
  expect(addFiles.mock.calls[0][0][1].name).toMatch(/\.txt$/);
});

it('preserves consecutive long pastes while the native clipboard is still being read', async () => {
  let resolve!: (files: File[]) => void;
  native.mockReturnValue(new Promise(done => { resolve = done; }));
  await act(async () => { shortcut(); event([], 'a'.repeat(20_000)); event([], 'b'.repeat(20_000)); });
  await act(async () => event([], 'ordinary text'));
  await act(async () => resolve([]));
  expect(addFiles).toHaveBeenCalledOnce();
  const files = addFiles.mock.calls[0][0];
  expect(files).toHaveLength(2); expect(files[0].name).not.toBe(files[1].name);
});

it('ignores a late long-text paste when leaving its conversation', async () => {
  let resolve!: (files: File[]) => void;
  native.mockReturnValue(new Promise(done => { resolve = done; }));
  await act(async () => { shortcut(); event([], 'a'.repeat(20_000)); });
  await render({ scope: 'other' });
  await act(async () => resolve([]));
  expect(addFiles).not.toHaveBeenCalled();
});
