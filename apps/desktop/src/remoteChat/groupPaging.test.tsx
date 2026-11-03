// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGroupingUI, type GroupingUI } from '../../../../shared/chat/groups/context';
import { usePagedGroupMembers } from '../../../../shared/chat/groups/usePagedGroupMembers';
import type { GroupClient, GroupMembersPage } from '../../../../shared/chat/groups/model';
import { defaultText } from '../../../../shared/localization/messages';

let root: Root;
let model: GroupingUI;
let paging: ReturnType<typeof usePagedGroupMembers>;
let client: GroupClient;
function Members() { paging = usePagedGroupMembers(model); return null; }
function Harness({ members = false }: { members?: boolean }) {
  model = useGroupingUI({ client, translate: defaultText, ready: true, lazyMembers: true });
  return model.managerOpen && members ? <Members /> : null;
}
const result = (page: number, pageSize = 20): GroupMembersPage => ({ data: [], page, pageSize, total: 150 });
function pending() {
  let resolve!: (value: GroupMembersPage) => void;
  const promise = new Promise<GroupMembersPage>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  client = { members: vi.fn(), mutate: vi.fn(), membersPage: vi.fn().mockResolvedValue(result(1)) };
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('waits until the members tab is mounted, pages remotely and resets size/search to the first page', async () => {
  await act(async () => model.openManager());
  expect(client.members).not.toHaveBeenCalled();
  expect(client.membersPage).not.toHaveBeenCalled();
  await act(async () => root.render(<Harness members />));
  expect(client.membersPage).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, search: '' });
  await act(async () => paging.changePage(3, 20));
  expect(client.membersPage).toHaveBeenLastCalledWith({ page: 3, pageSize: 20, search: '' });
  await act(async () => paging.changePage(3, 50));
  expect(client.membersPage).toHaveBeenLastCalledWith({ page: 1, pageSize: 50, search: '' });
  await act(async () => paging.setQuery('archived'));
  expect(paging.loading).toBe(true);
  await act(async () => vi.advanceTimersByTime(250));
  expect(client.membersPage).toHaveBeenLastCalledWith({ page: 1, pageSize: 50, search: 'archived' });
});

it('ignores an obsolete page and a previous computer response', async () => {
  const old = pending();
  vi.mocked(client.membersPage!).mockReturnValueOnce(old.promise).mockResolvedValue(result(2));
  await act(async () => { root.render(<Harness members />); model.openManager(); });
  await act(async () => paging.changePage(2, 20));
  expect(paging.result?.page).toBe(2);
  await act(async () => old.resolve(result(1)));
  expect(paging.result?.page).toBe(2);
  const previousComputer = pending();
  vi.mocked(client.membersPage!).mockReturnValueOnce(previousComputer.promise);
  await act(async () => paging.reload());
  client = { ...client, membersPage: vi.fn().mockResolvedValue({ ...result(1), total: 12 }) };
  await act(async () => root.render(<Harness members />));
  await act(async () => previousComputer.resolve(result(2)));
  expect(paging.result?.total).toBe(12);
});

it('keeps late failures inside the dismissed tab and supports retrying errors', async () => {
  vi.mocked(client.membersPage!).mockRejectedValueOnce(new Error('offline'));
  await act(async () => { root.render(<Harness members />); model.openManager(); });
  expect(paging.error).toBe('client.groups.loadFailed');
  await act(async () => paging.reload());
  expect(paging.error).toBe('');
  const late = pending();
  vi.mocked(client.membersPage!).mockReturnValueOnce(late.promise);
  await act(async () => paging.reload());
  await act(async () => model.closeManager());
  await act(async () => late.resolve(result(4)));
  expect(model.managerOpen).toBe(false);
  expect(model.error).toBe('');
});
