import { displayError } from '../../../../../../shared/localization/uiText';
import type { ReactElement } from 'react';
import { App, Input, Modal } from 'antd';
import { ThreadContextMenu } from '../../../../../../shared/chat/ThreadContextMenu';
import { threadMenuItems } from '../../../../../../shared/chat/threadMenuItems';
import { useRemoteProjectFolder } from '../../../../../../shared/chat/useRemoteProjectFolder';
import { threadPresentation } from '../../../../../../shared/remote-chat/sidebar';
import { uiText } from "../../../../../../shared/localization/uiText";
import type { ChatController, ChatState, Thread } from '../../../../../../shared/remote-chat/views/types';
import { forkUnavailableReason } from '../../../../../../shared/remote-chat/client/forkConversation';
import { THREAD_NAME_LIMIT, threadActionReason, type ThreadAction }
  from '../../../../../../shared/remote-chat/client/threadActions';
import type { ThreadActionsModel } from '../../../../../../shared/remote-chat/client/useThreadActions';

export function RemoteThreadMenu({ thread, state, controller, actions, onClose, children }: {
  thread: Thread; state: ChatState; controller: ChatController; actions: ThreadActionsModel;
  onClose: () => void; children: ReactElement;
}) {
  const { message } = App.useApp();
  const { openProject, projectFolderDialog } = useRemoteProjectFolder({ controller, state, translate: uiText });
  const { cwd } = threadPresentation(thread, state.sidebar);
  const pin = state.sidebar.pins?.includes(thread.id) ? 'unpin' : 'pin';
  const archive = state.archived ? 'unarchive' : 'archive';
  const disabled = (action: ThreadAction) => Boolean(threadActionReason(state, thread, action));
  const run = (action: ThreadAction) => {
    void controller.threadActions.run(thread, action).catch((error: unknown) => {
      void message.error(<span className="compact-confirm-copy">
        {displayError(error instanceof Error ? error.message : "client.errors.theOperationFailedPleaseTryAgain")}</span>);
    });
  };
  const items = threadMenuItems({ pinned: pin === 'unpin', archived: state.archived, translate: uiText,
    openProject: Boolean(cwd), openProjectDisabled: !state.ready,
    disabled: action => action === 'fork' ? Boolean(forkUnavailableReason(state, thread))
      : disabled(action === 'pin' ? pin : action === 'archive' ? archive : action) });
  return <><ThreadContextMenu groupTarget={{ kind: 'thread', id: thread.id }} menu={{ items,
    onClick: ({ key }) => {
      if (key === 'pin') run(pin);
      if (key === 'openProject') void openProject(cwd);
      if (key === 'archive') run(archive);
      if (key === 'fork') void controller.forkConversation(thread).then(opened => { if (opened) onClose(); });
      if (key === 'rename' || key === 'delete') { actions.open(thread); actions.changeView(key); }
    } }}>{children}</ThreadContextMenu>{projectFolderDialog}</>;
}

export function RemoteThreadDialogs({ actions }: { actions: ThreadActionsModel }) {
  if (!actions.target || actions.view === 'menu') return null;
  const { view, busy, name } = actions;
  const deleting = view === 'delete';
  const reason = actions.reason(view);
  return <Modal open title={uiText(deleting ? "client.threadActions.deleteThisChat" : "client.threadActions.renameChat")} width={400}
    okText={uiText(deleting ? "client.workspaceActions.moveToTrash" : "client.projectBrowser.save")} cancelText={uiText("client.accounts.cancel")} confirmLoading={busy}
    closable={!busy} maskClosable={!busy} keyboard={!busy} cancelButtonProps={{ disabled: busy }}
    okButtonProps={{ danger: deleting, disabled: busy || Boolean(reason) || (!deleting && !name.trim()) }}
    onCancel={actions.close} onOk={() => void actions.submit(view)}>
    {deleting ? <p className="compact-confirm-copy">
      {uiText("client.threadActions.thisChatAndAllItsChildChatsWillMoveTo")}</p>
      : <Input value={name} maxLength={THREAD_NAME_LIMIT} autoFocus disabled={busy}
        aria-label={uiText("client.threadActions.chatName")} onChange={event => actions.setName(event.target.value)} />}
    {(actions.error || reason) && <p role="alert" className="compact-confirm-copy">
      {displayError(actions.error || reason)}</p>}
  </Modal>;
}
