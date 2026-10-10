const LIST_REFRESH_DELAY_MS = 150;

/** Coalesce notifications without discarding a useful response already on its way. */
export class ThreadListRequests {
  generation = 0;
  private pending?: { key: string; promise: Promise<void> };
  private timer?: ReturnType<typeof setTimeout>;
  private dirty = false;

  constructor(private readonly refresh: () => Promise<void>) {}

  run(key: string, load: (generation: number) => Promise<void>) {
    if (this.pending?.key === key) return this.pending.promise;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.dirty = false;
    const generation = ++this.generation;
    const pending = { key, promise: Promise.resolve() };
    this.pending = pending;
    pending.promise = load(generation).finally(() => {
      if (this.pending !== pending) return;
      this.pending = undefined;
      if (this.dirty) this.schedule();
    });
    return pending.promise;
  }

  schedule() {
    this.dirty = true;
    if (this.pending || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.dirty = false;
      void this.refresh();
    }, LIST_REFRESH_DELAY_MS);
  }

  reset() {
    this.generation += 1;
    this.pending = undefined;
    this.dirty = false;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
