import { afterEach, expect, it, vi } from 'vitest';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import type { ChatConnection, ConnectionEvents } from '../../../../shared/remote-chat/client/connection';
import { CONNECTION_ERRORS } from '../../../../shared/remote-chat/connectionErrors';
import { historyDelta } from '../../../../shared/remote-chat/historySync';

const thread = { id: 'thread', cwd: '/project', preview: '', updatedAt: 1, turns: [] };
let controller: ChatController;
afterEach(() => controller?.stop());

async function harness() {
  let events!: ConnectionEvents;
  const request = vi.fn<ChatConnection['request']>(async (method, body) => {
    if (method === 'connect') return [];
    if ((body as { operation?: string })?.operation === 'syncHistory') return historyDelta(thread);
    return { data: [], nextCursor: null };
  });
  controller = new ChatController(callbacks => {
    events = callbacks;
    return { start() { events.mode('direct'); events.ready(); }, stop() {},
      request: <T>(...args: Parameters<ChatConnection['request']>) => request(...args) as Promise<T> };
  });
  controller.start();
  await vi.waitFor(() => expect(controller.snapshot().ready).toBe(true));
  return { events, request };
}

it('clears a failed list refresh only after the list loads successfully', async () => {
  const { request } = await harness();
  request.mockRejectedValueOnce(new Error('List unavailable'));
  await controller.list();
  expect(controller.snapshot().error).toBe('List unavailable');
  await controller.list();
  expect(controller.snapshot().error).toBe('');
});

it('does not let a list recovery clear a newer operation failure', async () => {
  const { events, request } = await harness();
  request.mockRejectedValueOnce(new Error('List unavailable'));
  await controller.list();
  events.error(CONNECTION_ERRORS.authorization);
  await controller.list();
  expect(controller.snapshot().error).toBe(CONNECTION_ERRORS.authorization);
});

it('ignores a late list failure after another filter has loaded successfully', async () => {
  const { request } = await harness();
  let reject!: (error: Error) => void;
  request.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const oldList = controller.list();
  await controller.list({ archived: true });
  reject(new Error('Obsolete list failed'));
  await oldList;
  expect(controller.snapshot()).toMatchObject({ archived: true, error: '' });
});

it('clears recovered history errors without clearing unrelated errors during background reads', async () => {
  const { events, request } = await harness();
  await controller.select(thread);
  request.mockRejectedValueOnce(new Error('History unavailable'));
  await controller.refreshSelected();
  expect(controller.snapshot().error).toBe('History unavailable');
  await controller.refreshSelected();
  expect(controller.snapshot().error).toBe('');
  events.error(CONNECTION_ERRORS.authorization);
  await controller.refreshSelected();
  expect(controller.snapshot().error).toBe(CONNECTION_ERRORS.authorization);
});

it.each(Object.keys(CONNECTION_ERRORS))('clears recovered connection error %s after chat is ready', async key => {
  const { events } = await harness();
  events.error(CONNECTION_ERRORS[key as keyof typeof CONNECTION_ERRORS]);
  events.mode('offline');
  events.mode('direct');
  events.ready();
  await vi.waitFor(() => expect(controller.snapshot()).toMatchObject({ ready: true, error: '', connectionIssue: '' }));
});
