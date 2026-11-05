// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { ChatOperations } from './operations';
import { remoteTerminals } from './terminals';
import { guiApi } from '../../../../shared/conversation/api';
import { summarizeTools } from '../../../../shared/conversation/toolDetails';
import { viewedThreadIds } from '../../../../shared/conversation/viewedThreads';
import { applyHistoryDelta } from '../../../../shared/remote-chat/historySync';
import type { PagedHistoryDelta } from '../../../../shared/remote-chat/historyPage';
import type { GuiEvent, Item, Thread } from '../../../../shared/conversation/types';

vi.mock('../api/backend', () => ({ invoke: vi.fn(), hasLocalBackend: false, isDesktopApp: false }));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));
vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn() } }));

const item: Item = { id: 'command', type: 'commandExecution', status: 'inProgress',
  command: 'npm test -- --runInBand', aggregatedOutput: 'private output'.repeat(100_000) };
const thread: Thread = { id: 'chat', cwd: '', preview: '', updatedAt: 0,
  turns: [{ id: 'turn', status: 'inProgress', items: [item] }] };
const started: GuiEvent = { method: 'item/started', params: { threadId: 'chat', turnId: 'turn', item } };
const hosts: ChatOperations[] = [];
afterEach(() => { hosts.splice(0).forEach(host => host.release()); vi.restoreAllMocks(); vi.clearAllMocks(); });

function fixture() {
  const host = new ChatOperations();
  hosts.push(host);
  let sequence = 0;
  vi.mocked(guiApi.request).mockImplementation(async request => {
    if (request.operation === 'toolDetails') return { item } as never;
    return { thread: request.operation === 'read' && request.includeToolDetails
      ? thread : summarizeTools(thread) } as never;
  });
  const request = (session: string, body: object) => host.execute({ kind: 'request',
    id: `view:${++sequence}`, method: 'request', body }, 'relay', session, 'shared-account');
  return { host, request };
}

it.each(['pc', 'web', 'mobile-web'])('delivers the running summary to %s before completion without details', async session => {
  const { host, request } = fixture();
  await request(session, { operation: 'viewThread', threadId: 'chat', deferToolDetails: true });
  const received = host.views.event(session, host.prepareEvent(started));
  expect(received?.params.item).toMatchObject({ status: 'inProgress', commandPreview: item.command,
    detailsRef: { threadId: 'chat', turnId: 'turn', itemId: 'command' } });
  expect(received?.params.item?.command).toBeUndefined();
  expect(received?.params.item?.aggregatedOutput).toBeUndefined();
  expect(guiApi.request).not.toHaveBeenCalled();
  expect(host.views.event(session, { method: 'item/commandExecution/outputDelta',
    params: { threadId: 'chat', turnId: 'turn', itemId: 'command', delta: 'private output' } })).toBeUndefined();
  const opened = await request(session, { operation: 'toolDetails', ...received!.params.item!.detailsRef });
  expect(opened.data).toEqual({ item });
});

it('keeps terminal ownership stable when the connection changes', async () => {
  const terminalRequest = vi.spyOn(remoteTerminals, 'request').mockResolvedValue([]);
  const { request } = fixture();
  const body = { operation: 'guiTerminalList' };
  await request('before-reconnect', body);
  await request('after-reconnect', body);
  expect(terminalRequest.mock.calls).toEqual([[body, 'shared-account'], [body, 'shared-account']]);
});

it('keeps same-account PC and legacy phone histories independent and releases only one connection', async () => {
  const { host, request } = fixture();
  await request('pc', { operation: 'viewThread', threadId: 'other', deferToolDetails: true });
  const phone = await request('phone', { operation: 'syncHistory', threadId: 'chat' });
  expect(phone.error).toBeUndefined();
  const restored = applyHistoryDelta({ ...thread, turns: [] }, phone.data as PagedHistoryDelta);
  expect(restored.turns![0].items[0].command).toBe(item.command);
  expect(restored.turns![0].items[0].aggregatedOutput).toBe(item.aggregatedOutput);
  expect(host.views.event('phone', started)).toEqual(started);
  expect(viewedThreadIds().sort()).toEqual(['chat', 'other']);
  host.release('pc');
  expect(viewedThreadIds()).toEqual(['chat']);
  host.release('phone');
  expect(viewedThreadIds()).toEqual([]);
});
