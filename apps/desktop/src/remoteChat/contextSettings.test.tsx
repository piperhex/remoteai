// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import { useContextSettings } from '../../../../shared/remote-chat/client/useContextSettings';
import type { ContextSettingsApi } from '../../../../shared/remote-chat/contextSettings';
import { ChatOperations } from './operations';
import { invoke } from '../api/backend';

vi.mock('../api/backend', () => ({ isDesktopApp: true, invoke: vi.fn() }));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));
let root: Root;
let editor: ReturnType<typeof useContextSettings>;
function Probe({ threadId, api }: { threadId: string; api: ContextSettingsApi }) {
  editor = useContextSettings(threadId, api);
  return <button onClick={() => editor.setValue('512')}>设置容量</button>;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(invoke).mockReset();
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

function controller() {
  const host = new ChatOperations();
  let id = 0;
  return new ChatController(() => ({
    request: async <T,>(method: 'request' | 'connect' | 'respond', body?: unknown) => {
      const response = await host.execute({ kind: 'request', id: `context:${++id}`, method, body });
      if (response.error) throw new Error(response.error);
      return response.data as T;
    },
    start: vi.fn(), stop: vi.fn(),
  }));
}

it('reads, saves and resets the same desktop settings using an explicit conversation through the mobile transport', async () => {
  const api = controller().contextSettings;
  vi.mocked(invoke).mockResolvedValue({ capacity: 128_000 });
  expect(await api.read('one')).toEqual({ capacity: 128_000 });
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_context_settings', { threadId: 'one' });
  await api.write('two', { capacity: 512_000 });
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_set_context_settings',
    { threadId: 'two', settings: { capacity: 512_000 } });
  await api.write('one', { capacity: null });
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_set_context_settings',
    { threadId: 'one', settings: { capacity: null } });
});

it.each([undefined, null, '', '../other', 'a/b', 123])('rejects unscoped or invalid mobile requests (%j)', async (threadId) => {
  const host = new ChatOperations();
  for (const operation of ['contextSettingsRead', 'contextSettingsWrite']) {
    const response = await host.execute({ kind: 'request', id: operation, method: 'request',
      body: { operation, threadId, settings: { capacity: 128_000 } } });
    expect(response.error).toBeTruthy();
  }
  expect(invoke).not.toHaveBeenCalled();
});

it('deduplicates a retried mobile save without writing twice', async () => {
  const host = new ChatOperations();
  vi.mocked(invoke).mockResolvedValue({ capacity: 256_000 });
  const request = { kind: 'request' as const, id: 'save', method: 'request' as const,
    body: { operation: 'contextSettingsWrite', threadId: 'one', settings: { capacity: 256_000 } } };
  const [first, second] = await Promise.all([host.execute(request), host.execute(request)]);
  expect(first).toEqual(second); expect(invoke).toHaveBeenCalledTimes(1);
});

it('keeps input and retry available while a mobile save fails, without overlapping writes', async () => {
  const api = controller().contextSettings;
  vi.mocked(invoke).mockResolvedValue({ capacity: 128_000 });
  await act(async () => root.render(<Probe threadId="one" api={api} />));
  await act(async () => editor.setValue('512'));
  let fail!: (error: Error) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  let saving!: Promise<boolean>;
  await act(async () => { saving = editor.save(); });
  await act(async () => { expect(await editor.save()).toBe(false); });
  expect(invoke).toHaveBeenCalledTimes(2);
  await act(async () => { fail(new Error('private host path')); expect(await saving).toBe(false); });
  expect(editor.value).toBe('512');
  expect(editor.error).toBe('未能保存或应用上下文设置，请重试；若对话已暂停，可点击继续。');
  vi.mocked(invoke).mockResolvedValueOnce({ capacity: 512_000 });
  await act(async () => { expect(await editor.save()).toBe(true); });
});
