import { beforeEach, expect, it, vi } from 'vitest';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke, Channel: class {
  onmessage?: (event: unknown) => void;
} }));
import { createFileClipboard } from '../../../../shared/remote-desktop/local/fileClipboard';

beforeEach(() => { invoke.mockReset(); });

it('revokes again after a read that was already in flight when the viewer closed', async () => {
  let finish!: (value: unknown) => void;
  invoke.mockImplementation((_command, args: { request: { action: string } }) =>
    args.request.action === 'read' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({}));
  const clipboard = createFileClipboard();
  const reading = clipboard.read(); clipboard.close();
  expect(invoke.mock.calls.filter(([, args]) => args.request.action === 'release')).toHaveLength(1);
  finish({ content: { format: 'text', text: 'late result' } }); await reading;
  await vi.waitFor(() => expect(invoke.mock.calls.filter(([, args]) => args.request.action === 'release')).toHaveLength(2));
  await expect(clipboard.read()).rejects.toThrow('连接已结束');
});

it('registers a fresh callback when publishing retries a temporary OS clipboard lock', async () => {
  invoke.mockRejectedValueOnce('无法访问剪贴板，请重新复制后再试。').mockResolvedValue({});
  const clipboard = createFileClipboard();
  await clipboard.publish({ id: crypto.randomUUID(), files: [{ name: 'a.txt', size: 1 }] }, async () => 'YQ==');
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke.mock.calls[0][1].onRead).not.toBe(invoke.mock.calls[1][1].onRead);
  clipboard.close();
});
