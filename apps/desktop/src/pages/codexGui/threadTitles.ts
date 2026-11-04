import { guiApi } from '../../../../../shared/conversation/api';
import { GuiTitleSettings } from './titleSettings';
import type { GuiEvent, Thread } from '../../../../../shared/conversation/types';

const MAX_TITLE_PROMPT_CHARACTERS = 4_000;

interface TitleHost {
  active: () => boolean;
  currentName: (threadId: string) => string | null | undefined;
  receive: (event: GuiEvent) => void;
}

export class GuiThreadTitles {
  readonly settings = new GuiTitleSettings();
  private requested = new Set<string>();
  constructor(private host: TitleHost) {}

  async generate(thread: Thread, prompt: string): Promise<void> {
    if (thread.name?.trim() || thread.turns?.length || !prompt.trim() || this.requested.has(thread.id)) return;
    this.requested.add(thread.id);
    try {
      const settings = await this.settings.snapshot();
      if (!this.host.active()) return;
      const result = await guiApi.request<{ title: string | null }>({ operation: 'generateTitle',
        threadId: thread.id, prompt: [...prompt.trim()].slice(0, MAX_TITLE_PROMPT_CHARACTERS).join(''), settings });
      if (result.title && this.host.active() && !this.host.currentName(thread.id)) {
        this.host.receive({ method: 'thread/name/updated',
          params: { threadId: thread.id, threadName: result.title } });
      }
    } catch {
      // Naming is best-effort; the preview remains visible and the main reply continues normally.
    }
  }
}
