import { getGuiController } from '../pages/codexGui/session';
import { guiSidebar } from '../pages/codexGui/sidebarBridge';
import type { GroupMutation } from '../../../../shared/chat/groups/model';

export async function remoteGroups(body: Record<string, unknown>) {
  const controller = getGuiController();
  if (body.action === 'members') {
    if (controller.getSnapshot().connection !== 'ready') await controller.connect({ reuseExisting: true });
    return controller.groups.members();
  }
  // The shared mutation service validates unknown RPC input before persistence.
  await controller.groups.mutate(body.mutation as GroupMutation);
  return guiSidebar.observe([]);
}
