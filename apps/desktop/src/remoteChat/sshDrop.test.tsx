// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SshDropTarget, type SshNativeDrop } from '../../../../shared/terminal/SshDropTarget';
import { droppedSshFiles } from '../../../../shared/terminal/sshDrop';
import type { FileDropEvent } from '../../../../shared/chat/useFileDrop';
import { nativeSshUploadBatch } from '../../../../shared/terminal/views/sshDrop';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, isTauri: () => false }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('only reads requested native chunks and closes source handles exactly once', async () => {
  native.invoke.mockResolvedValueOnce({ type: 'files', files: [{ token: 'native-token', name: 'large.bin', size: 999999 }] });
  const batch = await nativeSshUploadBatch(['C:\\fixture\\large.bin']);
  expect(native.invoke).toHaveBeenCalledOnce();
  native.invoke.mockResolvedValueOnce({ type: 'data', data: 'Ynl0ZXM=' });
  expect(await batch.files[0].read(262144, 5)).toBe('Ynl0ZXM=');
  expect(native.invoke).toHaveBeenLastCalledWith('codex_gui_ssh_drop_files', {
    request: { type: 'read', token: 'native-token', offset: 262144, length: 5 },
  });
  native.invoke.mockResolvedValueOnce({ type: 'done' });
  await batch.release!(); await batch.release!();
  expect(native.invoke).toHaveBeenCalledTimes(3);
  expect(native.invoke).toHaveBeenLastCalledWith('codex_gui_ssh_drop_files', {
    request: { type: 'close', tokens: ['native-token'] },
  });
});

it('rejects directories before treating their File objects as zero-byte files', () => {
  const data = { items: [{ webkitGetAsEntry: () => ({ isDirectory: true }) }], files: [] };
  expect(() => droppedSshFiles(data as unknown as DataTransfer)).toThrow('client.ssh.dropFilesOnly');
});

it('clears the browser drop overlay when a folder is rejected', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const target = document.createElement('div'); document.body.append(target);
  const root = createRoot(target);
  const report = vi.fn();
  const upload = vi.fn(async () => {});
  const data = { types: ['Files'], items: [{ webkitGetAsEntry: () => ({ isDirectory: true }) }],
    files: [new File([], 'folder')] };
  const dispatch = (type: string) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: data });
    target.firstElementChild!.dispatchEvent(event);
  };
  try {
    await act(async () => root.render(<SshDropTarget id="ssh-1" path="/home" active
      upload={upload} report={report}><div /></SshDropTarget>));
    await act(async () => dispatch('dragover'));
    expect(target.querySelector('.ssh-drop-overlay')).not.toBeNull();
    await act(async () => dispatch('drop'));
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'client.ssh.dropFilesOnly' }));
    expect(upload).not.toHaveBeenCalled();
    expect(target.querySelector('.ssh-drop-overlay')).toBeNull();
  } finally { await act(async () => root.unmount()); target.remove(); }
});

it('releases a delayed native drop when its terminal has become inactive', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const target = document.createElement('div'); document.body.append(target);
  const root = createRoot(target);
  let listener!: (event: FileDropEvent) => void;
  let resolve!: (batch: Awaited<ReturnType<SshNativeDrop['read']>>) => void;
  const release = vi.fn(async () => {});
  const upload = vi.fn(async () => {});
  const source: SshNativeDrop = { subscribe: async callback => { listener = callback; return () => {}; },
    read: () => new Promise(done => { resolve = done; }) };
  const render = (active: boolean) => <SshDropTarget id="ssh-1" path="/home" active={active}
    native={source} upload={upload} report={vi.fn()}><div /></SshDropTarget>;
  try {
    await act(async () => root.render(render(true)));
    vi.spyOn(target.firstElementChild!, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, toJSON: () => ({}),
    });
    await act(async () => listener({ type: 'drop', paths: ['fixture.txt'], position: { x: 10, y: 10 } }));
    await act(async () => root.render(render(false)));
    await act(async () => resolve({ files: [], release }));
    expect(upload).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); target.remove(); }
});
