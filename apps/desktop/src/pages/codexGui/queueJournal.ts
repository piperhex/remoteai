import type { GuiState, QueuedMessage } from '../../../../../shared/conversation/types';

export interface QueueSnapshot { revision: number; threads: GuiState['queued'] }
export interface QueueStorage {
  read(): Promise<QueueSnapshot>;
  save(snapshot: QueueSnapshot): Promise<QueueSnapshot>;
}
const UNCERTAIN_MESSAGE = '上次发送结果尚未确认，请查看聊天后决定是否重发。';

/** Persist before acknowledging or dispatching. An interrupted dispatch requires a deliberate retry. */
export class QueueJournal {
  private revision = 0;
  private initialized = false;
  private loading?: Promise<void>;
  private writing: Promise<void> = Promise.resolve();
  private error?: unknown;
  constructor(private readonly storage: QueueStorage | undefined,
    private readonly restoreQueue: (queue: GuiState['queued']) => void, private readonly failed: (error: unknown) => void) {}

  restore() {
    return this.loading ??= this.load().catch(error => { this.loading = undefined; throw error; });
  }
  private async load() {
    if (this.storage) {
      const snapshot = await this.storage.read();
      this.revision = snapshot.revision;
      const threads = Object.fromEntries(Object.entries(snapshot.threads).map(([id, messages]) => [id,
        messages.map((message): QueuedMessage => message.busy
          ? { ...message, busy: false, needsReview: true, error: UNCERTAIN_MESSAGE } : message)]));
      this.restoreQueue(threads);
    }
    this.initialized = true;
  }
  remember(threads: GuiState['queued']) {
    if (!this.storage || !this.initialized) return;
    this.writing = this.writing.then(async () => {
      try {
        const snapshot = await this.storage!.save({ revision: this.revision, threads });
        this.revision = snapshot.revision; this.error = undefined;
      } catch (error) { this.error = error; this.failed(error); }
    });
  }
  async saved() {
    await this.restore();
    // Include writes queued during the previous save, not just the promise observed on entry.
    let pending: Promise<void>;
    do { pending = this.writing; await pending; } while (pending !== this.writing);
    if (this.error) throw this.error;
  }
}
