import { expect, it, vi } from 'vitest';
import { createRemoteGroups } from '../../../../shared/remote-chat/client/groups';
import { emptySidebar } from '../../../../shared/remote-chat/sidebar';

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
