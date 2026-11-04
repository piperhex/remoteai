// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ComposerAttachment } from '../../../../../shared/chat/ComposerAttachment';
import { AttachmentMetadataContext } from '../../../../../shared/chat/attachmentMetadata';
import { AttachmentMetadataProvider } from './AttachmentMetadataProvider';
import { ChatAttachmentMetadata } from '../../../../../shared/remote-chat/views/ChatAttachmentMetadata';
import { ChatController } from '../../../../../shared/remote-chat/client/controller';
import { fileApi } from '../../../../../shared/conversation/fileApi';
import { uiText } from '../../../../../shared/localization/uiText';

let root: Root;
let host: HTMLDivElement;
const file = { kind: 'file' as const, name: 'report.jsonl', path: 'F:/remote/report.jsonl' };
const metadata = { name: file.name, path: file.path, size: 1234, directory: false, modifiedAt: 1_700_000_000_000 };
const remove = vi.fn();
const click = (selector: string) => act(async () => host.querySelector<HTMLButtonElement>(selector)!.click());
const chip = <ComposerAttachment file={file} t={uiText} disabled={false} onRemove={remove} />;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.spyOn(fileApi, 'perform').mockResolvedValue({ path: file.path, saved: false, metadata });
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); remove.mockReset();
});

it('reads local metadata only after a click and keeps removal separate', async () => {
  await act(async () => root.render(<AttachmentMetadataProvider>{chip}</AttachmentMetadataProvider>));
  expect(fileApi.perform).not.toHaveBeenCalled();
  await click('.cs-attachment-trigger');
  expect(fileApi.perform).toHaveBeenCalledExactlyOnceWith({ path: file.path, threadId: null }, { type: 'metadata' });
  expect(document.querySelector('.cs-attachment-details')?.textContent).toContain('1,234 字节');
  expect(remove).not.toHaveBeenCalled();
  await click('.cs-attachment-remove'); expect(remove).toHaveBeenCalledOnce();
});

it('uses the selected remote reader without falling back to local IPC on a failure', async () => {
  const controller = new ChatController(() => ({ request: vi.fn(), start: vi.fn(), stop: vi.fn() }));
  const remote = vi.spyOn(controller.guiTools.files, 'perform').mockRejectedValue(new Error('disconnected'));
  await act(async () => root.render(<ChatAttachmentMetadata controller={controller} ready threadId="remote-thread">
    <AttachmentMetadataProvider>{chip}</AttachmentMetadataProvider>
  </ChatAttachmentMetadata>));
  expect(remote).not.toHaveBeenCalled();
  await click('.cs-attachment-trigger');
  expect(remote).toHaveBeenCalledExactlyOnceWith({ path: file.path, threadId: 'remote-thread' }, { type: 'metadata' });
  expect(fileApi.perform).not.toHaveBeenCalled();
  expect(document.querySelector('.cs-attachment-details')?.textContent).toContain('暂时无法读取');
  controller.stop();
});

it('shows upload byte length without inventing a path or contacting a computer', async () => {
  const read = vi.fn();
  await act(async () => root.render(<AttachmentMetadataContext.Provider value={read}>
    <ComposerAttachment file={{ ...file, path: '', data: 'AAEC/w==' }} t={uiText} disabled onRemove={remove} />
  </AttachmentMetadataContext.Provider>));
  await click('.cs-attachment-trigger');
  expect(document.querySelector('.cs-attachment-details')?.textContent).toContain('4 字节');
  expect(document.querySelector('.cs-attachment-details')?.textContent).toContain('发送后可查看保存路径');
  expect(read).not.toHaveBeenCalled();
  expect(fileApi.perform).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLButtonElement>('.cs-attachment-remove')?.disabled).toBe(true);
});

it('ignores a late result after leaving the composer and closes its popover', async () => {
  let resolve!: (value: typeof metadata) => void;
  const read = vi.fn(() => new Promise<typeof metadata>(done => { resolve = done; }));
  const render = (active: boolean) => act(async () => root.render(<AttachmentMetadataContext.Provider value={read}>
    <ComposerAttachment file={file} t={uiText} active={active} disabled={false} onRemove={remove} />
  </AttachmentMetadataContext.Provider>));
  await render(true); await click('.cs-attachment-trigger'); await render(false);
  await act(async () => resolve(metadata));
  expect(host.querySelector('.cs-attachment-trigger')?.getAttribute('aria-expanded')).toBe('false');
  expect(document.querySelector('.cs-attachment-details')).toBeNull();
});
