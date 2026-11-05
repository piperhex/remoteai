import { beforeEach, expect, it, vi } from 'vitest';
const backend = vi.hoisted(() => ({ invoke: vi.fn(), isDesktopApp: true }));
vi.mock('../../../../../shared/platform/localBackend', () => backend);
beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); });

it('serializes rapid changes and resolves only after the newest union reaches native code', async () => {
  const { watchConversation, viewedThreadIds } = await import('../../../../../shared/conversation/viewedThreads');
  let finish!: () => void;
  backend.invoke.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  backend.invoke.mockResolvedValue(undefined);
  const local = {}; const remote = {};
  const first = watchConversation(local, 'a');
  const second = watchConversation(local, 'b');
  const third = watchConversation(remote, 'c');
  expect(backend.invoke).toHaveBeenCalledTimes(1);
  finish();
  await Promise.all([first, second, third]);
  expect(backend.invoke).toHaveBeenLastCalledWith('codex_gui_watch', { threadIds: ['b', 'c'] });
  await watchConversation(local, null);
  expect(viewedThreadIds()).toEqual(['c']);
  expect(backend.invoke).toHaveBeenLastCalledWith('codex_gui_watch', { threadIds: ['c'] });
});

it('retries a failed subscription without losing the latest selection', async () => {
  const { watchConversation } = await import('../../../../../shared/conversation/viewedThreads');
  backend.invoke.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const owner = {};
  await expect(watchConversation(owner, 'a')).rejects.toThrow('offline');
  await watchConversation(owner, 'a');
  expect(backend.invoke).toHaveBeenCalledTimes(2);
});

it('applies a selection changed between native acknowledgement and synchronizer cleanup', async () => {
  const { watchConversation } = await import('../../../../../shared/conversation/viewedThreads');
  backend.invoke.mockResolvedValue(undefined);
  const owner = {};
  const first = watchConversation(owner, 'a');
  await Promise.resolve();
  const second = watchConversation(owner, 'b');
  await Promise.all([first, second]);
  expect(backend.invoke).toHaveBeenLastCalledWith('codex_gui_watch', { threadIds: ['b'] });
});
