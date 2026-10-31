import type { LoungeController } from './controller';
import type { LoungeDraft, LoungeSnapshot } from './types';
import { orderedDirectContacts } from './contacts';

export function conversationRows(options: {
  state: LoungeSnapshot; controller: LoungeController; drafts: Record<string, LoungeDraft>;
}) {
  const { state, controller, drafts } = options;
  return [undefined, ...orderedDirectContacts(state.contacts, state.user?.id)]
    .map(contact => {
      const user = contact?.user;
      const id = user?.id ?? '';
      return { id, user, contact, online: state.status === 'connected' && contact?.online === true,
        blocked: !!user && state.blocked.includes(id),
        notificationsMuted: state.mutedConversations?.includes(id) ?? false,
        draft: drafts[id], last: controller.conversationPreview(id),
        unread: state.unreadByConversation[id] ?? 0 };
    });
}

export type ConversationRow = ReturnType<typeof conversationRows>[number];
