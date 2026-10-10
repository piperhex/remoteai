import type { ReactElement } from 'react';
import { App, Dropdown, Input, Modal } from 'antd';
import { Archive, Pencil, Pin, Split, Trash2 } from 'lucide-react';
import { guiText } from '../../../i18n/guiText';
import type { ChatController, ChatState, Thread } from '../../../../../web/src/chat/types';
import { forkUnavailableReason } from '../../../../../../shared/remote-chat/client/forkConversation';
import { THREAD_NAME_LIMIT, threadActionReason, type ThreadAction }
  from '../../../../../../shared/remote-chat/client/threadActions';
import type { ThreadActionsModel } from '../../../../../../shared/remote-chat/client/useThreadActions';

export function RemoteThreadMenu({ thread, state, controller, actions, onClose, children }: {
  thread: Thread; state: ChatState; controller: ChatController; actions: ThreadActionsModel;
  onClose: () => void; children: ReactElement;
}) {
  const { message } = App.useApp();
  const pin = state.sidebar.pins?.includes(thread.id) ? 'unpin' : 'pin';
  const archive = state.archived ? 'unarchive' : 'archive';
  const disabled = (action: ThreadAction) => Boolean(threadActionReason(state, thread, action));
  const run = (action: ThreadAction) => {
    void controller.threadActions.run(thread, action).catch((error: unknown) => {
      void message.error(<span className="compact-confirm-copy">
        {guiText(error instanceof Error ? error.message : '操作未完成，请稍后重试。')}</span>);
    });
  };
  const items = [
    { key: 'pin', label: guiText(pin === 'pin' ? '置顶' : '取消置顶'), icon: <Pin size={14} />,
      disabled: disabled(pin) },
    { key: 'rename', label: guiText('重命名'), icon: <Pencil size={14} />, disabled: disabled('rename') },
    { key: 'fork', label: guiText('创建分支'), icon: <Split size={14} />,
      disabled: Boolean(forkUnavailableReason(state, thread)) },
    { key: 'archive', label: guiText(state.archived ? '恢复对话' : '归档'), icon: <Archive size={14} />,
      disabled: disabled(archive) },
    { key: 'delete', label: guiText('删除'), icon: <Trash2 size={14} />, danger: true, disabled: disabled('delete') },
  ];
  return <Dropdown trigger={['contextMenu']} overlayStyle={{ maxWidth: 400 }} menu={{ items,
    onClick: ({ key }) => {
      if (key === 'pin') run(pin);
      if (key === 'archive') run(archive);
      if (key === 'fork') void controller.forkConversation(thread).then(opened => { if (opened) onClose(); });
      if (key === 'rename' || key === 'delete') { actions.open(thread); actions.changeView(key); }
    } }}>{children}</Dropdown>;
}

export function RemoteThreadDialogs({ actions }: { actions: ThreadActionsModel }) {
  if (!actions.target || actions.view === 'menu') return null;
  const { view, busy, name } = actions;
  const deleting = view === 'delete';
  const reason = actions.reason(view);
  return <Modal open title={guiText(deleting ? '删除这条对话？' : '重命名对话')} width={400}
    okText={guiText(deleting ? '移入回收站' : '保存')} cancelText={guiText('取消')} confirmLoading={busy}
    closable={!busy} maskClosable={!busy} keyboard={!busy} cancelButtonProps={{ disabled: busy }}
    okButtonProps={{ danger: deleting, disabled: busy || Boolean(reason) || (!deleting && !name.trim()) }}
    onCancel={actions.close} onOk={() => void actions.submit(view)}>
    {deleting ? <p className="compact-confirm-copy">
      {guiText('这条对话及其所有子对话将一起移入回收站，可在电脑端“会话管理”中恢复。')}</p>
      : <Input value={name} maxLength={THREAD_NAME_LIMIT} autoFocus disabled={busy}
        aria-label={guiText('对话名称')} onChange={event => actions.setName(event.target.value)} />}
    {(actions.error || reason) && <p role="alert" className="compact-confirm-copy">
      {guiText(actions.error || reason)}</p>}
  </Modal>;
}
