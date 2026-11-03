import { expect, it, vi } from 'vitest';
import { createRemoteGroups } from '../../../../shared/remote-chat/client/groups';
import { emptySidebar } from '../../../../shared/remote-chat/sidebar';
import { GROUPS_UNSUPPORTED_ERROR } from '../../../../shared/chat/groups/model';

it('applies a host mutation result and rejects a late reply after changing computers', async () => {
  let generation = 1;
  const apply = vi.fn();
  const request = vi.fn().mockResolvedValue({ ...emptySidebar(), revision: 1 });
  const client = createRemoteGroups({ generation: () => generation, ready: () => true, request, apply });
  await client.mutate({ action: 'assign', targets: [{ kind: 'thread', id: 'one' }], groupId: null });
  expect(request).toHaveBeenCalledWith({ operation: 'guiGroups', mutation: {
    action: 'assign', targets: [{ kind: 'thread', id: 'one' }], groupId: null,
  } });
  expect(apply).toHaveBeenCalledOnce();
  request.mockImplementation(async () => { generation++; return emptySidebar(); });
  await expect(client.mutate({ action: 'delete', id: 'group' })).rejects.toThrow('connectToYourComputerFirst');
  expect(apply).toHaveBeenCalledOnce();
});

it('reports that an older host needs updating for both reads and writes', async () => {
  const request = vi.fn().mockRejectedValue(new Error('当前手机端暂不支持此操作。'));
  const apply = vi.fn();
  const client = createRemoteGroups({ generation: () => 1, ready: () => true, request, apply });
  await expect(client.members()).rejects.toThrow(GROUPS_UNSUPPORTED_ERROR);
  await expect(client.mutate({ action: 'delete', id: 'group' })).rejects.toThrow(GROUPS_UNSUPPORTED_ERROR);
  expect(apply).not.toHaveBeenCalled();
});

it('preserves unrelated request failures instead of suggesting an update', async () => {
  const failure = new Error('network unavailable');
  const request = vi.fn().mockRejectedValue(failure);
  const client = createRemoteGroups({ generation: () => 1, ready: () => true, request, apply: vi.fn() });
  await expect(client.members()).rejects.toBe(failure);
});

it('pages on the host and rejects stale page replies after switching computers', async () => {
  let generation = 1;
  const page = { data: [], total: 0, page: 1, pageSize: 50 };
  const request = vi.fn().mockResolvedValue(page);
  const client = createRemoteGroups({ generation: () => generation, ready: () => true, request, apply: vi.fn() });
  const query = { page: 1, pageSize: 50, search: 'archived' };
  await expect(client.membersPage!(query)).resolves.toEqual(page);
  expect(request).toHaveBeenCalledExactlyOnceWith({ operation: 'guiGroups', action: 'membersPage', query });
  request.mockImplementation(async () => { generation++; return page; });
  await expect(client.membersPage!(query)).rejects.toThrow('connectToYourComputerFirst');
});

it('asks to update old group hosts instead of silently fetching their entire history', async () => {
  const request = vi.fn().mockRejectedValue(new Error('client.groups.invalid'));
  const client = createRemoteGroups({ generation: () => 1, ready: () => true, request, apply: vi.fn() });
  await expect(client.membersPage!({ page: 1, pageSize: 20, search: '' })).rejects.toThrow(GROUPS_UNSUPPORTED_ERROR);
  expect(request).toHaveBeenCalledOnce();
});
