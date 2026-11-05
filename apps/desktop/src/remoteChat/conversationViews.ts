import { watchConversation } from '../../../../shared/conversation/viewedThreads';
import { visibleConversationEvent } from '../../../../shared/conversation/eventVisibility';
import type { GuiEvent } from '../../../../shared/conversation/types';
import { uiText } from '../../../../shared/localization/uiText';
import { summarizeToolEvent } from '../../../../shared/conversation/toolDetails';

/** Each connection owns one view. Disconnecting one client cannot unsubscribe another. */
export class ConversationViews {
  private readonly viewers = new Map<string, {
    owner: object; threadId: string | null; explicit: boolean; deferDetails: boolean;
  }>();

  async select(session: string, id: unknown, explicit = true, deferDetails = false) {
    if (id !== null && (typeof id !== 'string' || !id || id.length > 256)) {
      throw new Error(uiText('client.runtimeErrors.selectAChatAndTryAgain'));
    }
    const viewer = this.viewers.get(session) ?? { owner: {}, threadId: null, explicit: false, deferDetails };
    if (!explicit && viewer.explicit) return;
    viewer.threadId = id;
    viewer.explicit = explicit;
    viewer.deferDetails = deferDetails;
    this.viewers.set(session, viewer);
    await watchConversation(viewer.owner, id, !deferDetails);
  }

  event(session: string, event: GuiEvent) {
    const visible = visibleConversationEvent(event, this.viewers.get(session)?.threadId ?? null);
    return visible && this.deferred(session) ? summarizeToolEvent(visible) : visible;
  }

  deferred(session: string) { return this.viewers.get(session)?.deferDetails ?? false; }

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
