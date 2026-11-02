import { GROUPS_OPERATION, type GroupClient } from '../../chat/groups/model';
import type { SidebarSnapshot } from '../sidebar';

export function createRemoteGroups(context: {
  ready: () => boolean; generation: () => number;
  request: <T>(body: object) => Promise<T>; apply: (sidebar: SidebarSnapshot) => void;
}): GroupClient {
  const request = async <T>(body: object): Promise<T> => {
    if (!context.ready()) throw new Error('client.errors.connectToYourComputerFirst');
    const generation = context.generation();
    const result = await context.request<T>({ operation: GROUPS_OPERATION, ...body });
    if (generation !== context.generation() || !context.ready()) {
      throw new Error('client.errors.connectToYourComputerFirst');
    }
    return result;
  };
  return {
    members: () => request({ action: 'members' }),
    mutate: async mutation => context.apply(await request<SidebarSnapshot>({ mutation })),
  };
}
