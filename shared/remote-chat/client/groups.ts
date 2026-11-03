import { GROUPS_OPERATION, GROUPS_UNSUPPORTED_ERROR, type GroupClient } from '../../chat/groups/model';
import type { SidebarSnapshot } from '../sidebar';
import { readMembersPage, readMembersQuery } from '../../chat/groups/memberPaging';

export function createRemoteGroups(context: {
  ready: () => boolean; generation: () => number;
  request: <T>(body: object) => Promise<T>; apply: (sidebar: SidebarSnapshot) => void;
}): GroupClient {
  const request = async <T>(body: object): Promise<T> => {
    if (!context.ready()) throw new Error('client.errors.connectToYourComputerFirst');
    const generation = context.generation();
    const result = await context.request<T>({ operation: GROUPS_OPERATION, ...body }).catch(failure => {
      // Older hosts return this fixed protocol error before group operations were introduced.
      if (failure instanceof Error && failure.message === '当前手机端暂不支持此操作。') {
        throw new Error(GROUPS_UNSUPPORTED_ERROR);
      }
      throw failure;
    });
    if (generation !== context.generation() || !context.ready()) {
      throw new Error('client.errors.connectToYourComputerFirst');
    }
    return result;
  };
  return {
    members: () => request({ action: 'members' }),
    membersPage: async query => {
      try { return readMembersPage(await request({ action: 'membersPage', query: readMembersQuery(query) })); }
      catch (failure) {
        // Group-aware hosts from before paging interpret unknown actions as a missing mutation.
        if (failure instanceof Error && failure.message === 'client.groups.invalid') {
          throw new Error(GROUPS_UNSUPPORTED_ERROR);
        }
        throw failure;
      }
    },
    mutate: async mutation => context.apply(await request<SidebarSnapshot>({ mutation })),
  };
}
