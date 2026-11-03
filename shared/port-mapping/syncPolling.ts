export interface MappingSyncEnvironment {
  snapshot(): { online: boolean; foreground: boolean };
  subscribe(listener: () => void): () => void;
}

export const MAPPING_POLL_MS = { active: 30_000, idle: 60_000, background: 120_000, retry: 5_000 } as const;
const MAX_FAILURES = 6;

/** HTTP reachability is independent of whether a target computer's tunnel is connected. */
export const browserMappingEnvironment: MappingSyncEnvironment = {
  snapshot: () => ({ online: typeof navigator === 'undefined' || navigator.onLine !== false,
    foreground: typeof document === 'undefined' || document.visibilityState !== 'hidden' }),
  subscribe: listener => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
    window.addEventListener('online', listener);
    window.addEventListener('offline', listener);
    document.addEventListener('visibilitychange', listener);
    return () => {
      window.removeEventListener('online', listener);
      window.removeEventListener('offline', listener);
      document.removeEventListener('visibilitychange', listener);
    };
  },
};

/** One-shot scheduling bounds idle traffic; failures never permanently disable remote discovery. */
export class MappingSyncPolling {
  private timer?: ReturnType<typeof setTimeout>;
  private failures = 0;
  private pending = false;
  private active = false;
  private stopped = true;
  private unsubscribe?: () => void;

  constructor(private readonly refresh: () => void,
    readonly environment: MappingSyncEnvironment = browserMappingEnvironment) {}

  start() {
    this.stopped = false;
    let previous = this.environment.snapshot();
    this.unsubscribe = this.environment.subscribe(() => {
      const next = this.environment.snapshot();
      const restored = next.online && (!previous.online || next.foreground && !previous.foreground);
      previous = next;
      if (restored) { this.failures = 0; this.refresh(); }
      else this.schedule();
    });
  }

  setActive(active: boolean) {
    if (active === this.active) return;
    this.active = active;
    if (active && !this.stopped) this.refresh();
    else this.schedule();
  }

  begin() { clearTimeout(this.timer); }

  finish(failed: boolean, pending: boolean) {
    this.failures = failed ? Math.min(this.failures + 1, MAX_FAILURES) : 0;
    this.pending = pending;
    this.schedule();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.unsubscribe?.();
  }

  private schedule() {
    clearTimeout(this.timer);
    if (this.stopped) return;
    const state = this.environment.snapshot();
    let delay: number = this.active ? MAPPING_POLL_MS.active : MAPPING_POLL_MS.idle;
    if (this.pending) delay = MAPPING_POLL_MS.retry;
    if (this.failures) delay = Math.min(MAPPING_POLL_MS.retry * 2 ** (this.failures - 1), MAPPING_POLL_MS.background);
    if (!state.foreground || !state.online) delay = Math.max(delay, MAPPING_POLL_MS.background);
    this.timer = setTimeout(this.refresh, delay);
  }
}
