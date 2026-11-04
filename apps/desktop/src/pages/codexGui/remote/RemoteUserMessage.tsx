import type { ChatController } from '../../../../../../shared/remote-chat/client/controller';
import { canEditRemoteMessage } from '../../../../../../shared/remote-chat/client/messageEdit';
import type { ChatState } from '../../../../../../shared/remote-chat/client/types';
import { lastUserMessage } from '../../../../../../shared/conversation/editMessage';
import { MessageEditContext } from '../messageEditContext';
import { UserMessage } from '../UserMessage';
import type { Item, Turn } from '../../../../../../shared/conversation/types';

export function RemoteUserMessage({ item, turn, state, controller, active }: {
  item: Item; turn: Turn; state: ChatState; controller: ChatController; active: boolean;
}) {
  const last = lastUserMessage({ turns: state.selected?.turns ?? [] });
  const editable = last?.turnId === turn.id && last.item.id === item.id;
  const target = { threadId: state.selected?.id ?? '', turnId: turn.id, itemId: item.id };
  return <MessageEditContext.Provider value={{ cwd: state.selected?.cwd ?? '', active,
    loadSkills: controller.loadComposerCatalog }}>
    <UserMessage item={item} startedAt={turn.startedAt}
      editDisabled={!active || !canEditRemoteMessage(state) || Boolean(item.localEcho)}
      onEdit={editable ? content => controller.messageEditor.submit({ ...target, ...content }) : undefined}
      onDelete={editable ? () => controller.messageEditor.remove(target) : undefined} />
  </MessageEditContext.Provider>;
}
