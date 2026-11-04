import { getGuiController } from '../pages/codexGui/session';
import type { Thread } from '../../../../shared/conversation/types';

/** Remote sends bypass GuiController.send, but share its naming settings and deduplication. */
export class RemoteThreadTitles {
  private readonly emptyThreads = new Map<string, Thread>();

  refreshSettings() { void getGuiController().titles.settings.refresh(); }
  clear() { this.emptyThreads.clear(); }

  completed(body: Record<string, unknown>, result: unknown) {
    if (body.operation === 'start' || body.operation === 'resume') {
      const thread = (result as { thread?: Thread } | null)?.thread;
      if (!thread) return;
      if (thread.name?.trim() || thread.turns?.length) this.emptyThreads.delete(thread.id);
      else this.emptyThreads.set(thread.id, thread);
      return;
    }
    if (body.operation !== 'send' || typeof body.threadId !== 'string' || typeof body.text !== 'string') return;
    const thread = this.emptyThreads.get(body.threadId);
    this.emptyThreads.delete(body.threadId);
    if (thread) void getGuiController().titles.generate(thread, body.text);
  }
}
