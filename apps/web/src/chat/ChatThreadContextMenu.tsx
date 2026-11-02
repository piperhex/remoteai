import { displayText } from '../i18n/index';
import type { ReactElement, HTMLAttributes } from 'react';
import { App } from 'antd';
import { threadMenuItems } from '../../../../shared/chat/threadMenuItems';
import { forkUnavailableReason } from '../../../../shared/remote-chat/client/forkConversation';
import { ThreadContextMenu } from '../../../../shared/chat/ThreadContextMenu';
import { threadActionReason } from '../../../../shared/remote-chat/client/threadActions';
import type { ThreadActionsModel } from '../../../../shared/remote-chat/client/useThreadActions';
import type { ChatState, Thread } from './types';
import { t } from '../i18n';

export function ChatThreadContextMenu({ thread, state, actions, onFork, onOpenProject, children }: {
  thread: Thread; state: ChatState; actions: ThreadActionsModel;
  onFork: () => void; onOpenProject?: () => Promise<void>;
  children: ReactElement<HTMLAttributes<HTMLElement>>;
}) {
  const { message } = App.useApp();
  const current = actions.target?.thread.id === thread.id && actions.view === 'menu';
  const archive = state.archived ? 'unarchive' : 'archive';
  const pin = state.sidebar.pins?.includes(thread.id) ? 'unpin' : 'pin';
  const reason = (action: 'rename' | 'delete' | typeof archive | typeof pin) => threadActionReason(state, thread, action);
  const hint = (current && actions.error) || reason(archive);
  const items = [
    ...threadMenuItems({ pinned: pin === 'unpin', archived: state.archived, translate: t,
      openProject: Boolean(onOpenProject),
      disabled: action => action === 'fork' ? Boolean(forkUnavailableReason(state, thread))
        : Boolean(reason(action === 'pin' ? pin : action === 'archive' ? archive : action)) }),
    ...(hint ? [{ key: 'hint', disabled: true, label: <span role="alert">{displayText(hint)}</span> }] : []),
  ];
  return <ThreadContextMenu groupTarget={{ kind: 'thread', id: thread.id }}
    open={current} disabled={!state.ready || state.sending}
    onOpenChange={(open, info) => {
      if (info.source === 'menu') return;
      if (open) actions.open(thread); else actions.close();
    }} menu={{ items, onClick: ({ key }) => {
      if (key.startsWith('moveGroup:') || key === 'manageGroups') actions.close();
      if (key === 'rename' || key === 'delete') actions.changeView(key);
      if (key === 'archive') void actions.submit(archive);
      if (key === 'pin') void actions.submit(pin);
      if (key === 'openProject' && onOpenProject) {
        actions.close();
        void onOpenProject().catch(() => {
          void message.error({ content: t('client.errors.theOperationFailedPleaseTryAgain'),
            style: { maxWidth: 400, marginInline: 'auto' } });
        });
      }
      if (key === 'fork') { actions.close(); onFork(); }
    } }}>{children}</ThreadContextMenu>;
}
