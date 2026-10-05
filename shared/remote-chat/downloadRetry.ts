const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

/** Only verified progress earns another recovery budget; a dead connection cannot loop forever. */
export class DownloadRetry {
  private attempts = new Map<string, { progress: number; count: number }>();

  next(id: string, verifiedBytes: number) {
    const previous = this.attempts.get(id);
    const count = previous && verifiedBytes <= previous.progress ? previous.count : 0;
    const delay = RETRY_DELAYS_MS[count];
    this.attempts.set(id, { progress: Math.max(verifiedBytes, previous?.progress ?? 0), count: count + 1 });
    return delay;
  }

  clear(id: string) { this.attempts.delete(id); }
}
