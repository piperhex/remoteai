import { getGuiController } from '../pages/codexGui/session';
import type { GuiController } from '../pages/codexGui/controller';
import type { GuiEvent, Thread } from '../../../../shared/conversation/types';
import { acknowledgedEvents } from '../../../../shared/chat/acknowledgedMessages';
import { updateThread } from '../../../../shared/remote-chat/client/events';

/** Publish PC-confirmed messages immediately, even before app-server emits or persists the user item. */
export class AcknowledgedMessages {
  constructor(private readonly controller: () => GuiController = getGuiController) {}

  merge(thread: Thread) {
    const current = this.controller().getSnapshot().conversations[thread.id];
    if (!current) return thread;
    return acknowledgedEvents({ ...current.thread, turns: current.turns }).reduce(updateThread, thread);
  }

  subscribe(listener: (event: GuiEvent) => void, enabled = () => true) {
    const controller = this.controller();
    let previous = controller.getSnapshot().conversations;
    const sent = new WeakSet<object>();
    return controller.subscribeMessageUpdates(() => {
      const conversations = controller.getSnapshot().conversations;
      if (conversations === previous) return;
      const before = previous;
      previous = conversations;
      if (!enabled()) return;
      for (const [id, conversation] of Object.entries(conversations)) {
        if (conversation === before[id]) continue;
        for (const event of acknowledgedEvents({ ...conversation.thread, turns: conversation.turns })) {
          const item = event.params.item!;
          if (sent.has(item)) continue;
          sent.add(item);
          listener(event);
        }
      }
    });
  }
}

export const acknowledgedMessages = new AcknowledgedMessages();
