import { uiText } from '../../../../../shared/localization/uiText';
import { directoryProject, type ProjectDirectoriesResponse } from '../../../../../shared/remote-chat/projectDirectories';
import type { GuiController } from './controller';
import { guiApi } from '../../../../../shared/conversation/api';

const MAX_PATH_LENGTH = 4096;
const THREAD_ID = /^[a-zA-Z0-9_-]{1,200}$/;
type ProjectHost = Pick<GuiController, 'getSnapshot' | 'setWorkspaceBusy' | 'retainConversation'
  | 'connect' | 'loadRemoteThread' | 'projectActions'>;

/** Validate the destination and load the moved chat without changing the active conversation or draft. */
export async function selectGuiProject(controller: ProjectHost, body: Record<string, unknown>) {
  const { cwd, threadId, removeFromGroup } = body;
  if (typeof cwd !== 'string' || !cwd.trim() || cwd.length > MAX_PATH_LENGTH || cwd.includes('\0')
    || (threadId !== undefined && (typeof threadId !== 'string' || !THREAD_ID.test(threadId)))
    || (removeFromGroup !== undefined && typeof removeFromGroup !== 'boolean')
    || (removeFromGroup && !threadId)) {
    throw new Error(uiText('client.workspaceActions.chooseAValidProjectFolder'));
  }
  if (controller.getSnapshot().workspaceBusy || controller.getSnapshot().sending) {
    throw new Error(uiText('client.workspaceActions.theProjectIsBusyPleaseTryAgainShortly'));
  }
  controller.setWorkspaceBusy(true);
  const release = threadId ? controller.retainConversation(threadId) : undefined;
  try {
    if (controller.getSnapshot().connection !== 'ready') await controller.connect({ reuseExisting: true });
    if (controller.getSnapshot().connection !== 'ready') {
      throw new Error(uiText('client.remoteHostMessages.theComputerIsnTReadyYetTryAgainLater'));
    }
    const directory = await guiApi.request<ProjectDirectoriesResponse>({ operation: 'projectDirectories', directory: cwd });
    if (!directory.directory) throw new Error(uiText('client.workspaceActions.chooseAValidProjectFolder'));
    if (threadId) await controller.loadRemoteThread(threadId);
    if (!controller.projectActions.selectRemote(directory.directory, threadId, removeFromGroup === true)) {
      throw new Error(uiText('client.workspaceActions.waitForTheCurrentTaskAndQueuedMessagesToFinish'));
    }
    return directoryProject(directory.directory);
  } finally { controller.setWorkspaceBusy(false); release?.(); }
}
