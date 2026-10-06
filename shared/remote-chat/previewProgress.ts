export interface PreviewProgress {
  received: number;
  total?: number;
  bytesPerSecond?: number;
  status: string;
}

export interface PreviewLoadOptions {
  onProgress?: (progress: PreviewProgress) => void;
  /** Stop observing when the view closes; the shared download can still serve other views. */
  signal?: AbortSignal;
}

export type PreviewImageLoader = (options?: PreviewLoadOptions) => Promise<string>;

/** Fan out one transfer's updates, including its checkpoint, to all active preview consumers. */
export class PreviewProgressEmitter {
  private latest: PreviewProgress = { received: 0, status: 'preparing' };
  private readonly listeners = new Set<(progress: PreviewProgress) => void>();

  subscribe({ onProgress, signal }: PreviewLoadOptions) {
    if (!onProgress || signal?.aborted) return () => {};
    const remove = () => {
      this.listeners.delete(onProgress);
      signal?.removeEventListener('abort', remove);
    };
    this.listeners.add(onProgress);
    signal?.addEventListener('abort', remove, { once: true });
    onProgress(this.latest);
    return remove;
  }

  update(task: { received: number; size: number; bytesPerSecond?: number; status: string }) {
    const total = task.size === 0 && ['queued', 'preparing'].includes(task.status) ? undefined : task.size;
    const bytesPerSecond = task.status === 'downloading' ? task.bytesPerSecond : undefined;
    if (this.latest.received === task.received && this.latest.total === total
      && this.latest.bytesPerSecond === bytesPerSecond && this.latest.status === task.status) return;
    this.latest = { received: task.received, total, bytesPerSecond, status: task.status };
    this.listeners.forEach(listener => listener(this.latest));
  }
}
