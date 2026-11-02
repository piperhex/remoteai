import type { ReactElement } from 'react';
import { App } from 'antd';
import { ProjectContextMenu } from '../../chat/ProjectContextMenu';
import { useOpenProjectFolder } from '../../chat/useOpenProjectFolder';
import { remoteErrorText } from '../../localization/errors';
import type { MessageTranslator } from '../../localization/messages';
import { projectActionReason, type ProjectAction } from './projectActions';
import type { ChatController } from './controller';
import type { ChatState } from './types';

export function RemoteProjectMenu({ cwd, label, state, controller, translate, buttonClassName,
  showActionButton = true, children }: {
  cwd: string; label: string; state: ChatState;
  controller: Pick<ChatController, 'projectActions' | 'guiTools'>;
  translate: MessageTranslator; buttonClassName: string; showActionButton?: boolean; children: ReactElement;
}) {
  const { message } = App.useApp();
  const openProject = useOpenProjectFolder(controller.guiTools.files, translate);
  const pinned = Boolean(state.sidebar.pinnedProjects?.includes(cwd));
  const disabled = Boolean(projectActionReason(state));
  const run = async (action: ProjectAction) => {
    try {
      await controller.projectActions.run(cwd, action);
      if (action === 'remove') void message.success(<span className="compact-confirm-copy">
        {translate('client.conversation.projectRemovedItsConversationsAreNowInRecent')}</span>);
    } catch (error) {
      void message.error(<span className="compact-confirm-copy">{remoteErrorText(error instanceof Error
        ? error.message : 'client.errors.theOperationFailedPleaseTryAgain')}</span>);
    }
  };
  return <ProjectContextMenu groupPath={cwd} label={label} pinned={pinned} removing={state.projectActionBusy === cwd}
    pinDisabled={disabled} removeDisabled={disabled} onPin={() => void run(pinned ? 'unpin' : 'pin')}
    onOpen={() => void openProject(cwd)} openDisabled={!state.ready}
    onRemove={() => void run('remove')} translate={translate} buttonClassName={buttonClassName}
    showActionButton={showActionButton}>
    {children}
  </ProjectContextMenu>;
}
