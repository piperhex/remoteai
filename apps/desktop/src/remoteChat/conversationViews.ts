import { watchConversation } from '../../../../shared/conversation/viewedThreads';
import { visibleConversationEvent } from '../../../../shared/conversation/eventVisibility';
import type { GuiEvent } from '../../../../shared/conversation/types';
import { uiText } from '../../../../shared/localization/uiText';

/** Each connection owns one view. Disconnecting one client cannot unsubscribe another. */
export class ConversationViews {
  private readonly viewers = new Map<string, { owner: object; threadId: string | null; explicit: boolean }>();

  async select(session: string, id: unknown, explicit = true) {
    if (id !== null && (typeof id !== 'string' || !id || id.length > 256)) {
      throw new Error(uiText('client.runtimeErrors.selectAChatAndTryAgain'));
    }
    const viewer = this.viewers.get(session) ?? { owner: {}, threadId: null, explicit: false };
    if (!explicit && viewer.explicit) return;
    viewer.threadId = id;
    viewer.explicit = explicit;
    this.viewers.set(session, viewer);
    await watchConversation(viewer.owner, id);
  }

  event(session: string, event: GuiEvent) {
    return visibleConversationEvent(event, this.viewers.get(session)?.threadId ?? null);
  }

  release(session?: string) {
    for (const [id, viewer] of this.viewers) {
      if (session !== undefined && session !== id) continue;
      this.viewers.delete(id);
      void watchConversation(viewer.owner, null).catch(error => {
        console.error('Could not release remote conversation subscription', error);
      });
    }
  }
}
