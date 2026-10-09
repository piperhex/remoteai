import type { NativeChannel, NativePathFactory, NativePathOptions } from './nativePath';

const NATIVE_RETRY_MS = 5_000;

/** Restart a terminated native engine without replacing healthy paths or the authenticated chat session. */
export class NativePathRecovery {
  private current?: NativeChannel;
  private lastAttempt = 0;
  private stopped = false;
  private expiresAt: number;

  constructor(private readonly options: NativePathOptions, private readonly create: NativePathFactory,
    private readonly attach: (channel: NativeChannel) => void) {
    this.expiresAt = options.config.expiresAt;
    this.start();
  }

  private start() {
    this.lastAttempt = Date.now();
    let channel: NativeChannel | undefined;
    try {
      channel = this.create({ ...this.options, config: { ...this.options.config, expiresAt: this.expiresAt } });
      if (channel.readyState === 'closed') return;
      this.attach(channel);
      this.current = channel;
    } catch {
      channel?.close();
      this.current = undefined;
      this.options.diagnostic?.('path-state', { transport: 'mesh', state: 'failed' });
    }
  }

  recover(signaling: boolean) {
    if (this.stopped || !signaling || this.expiresAt <= Date.now()
      || (this.current && this.current.readyState !== 'closed') || Date.now() - this.lastAttempt < NATIVE_RETRY_MS) return;
    this.start();
  }

  renew(expiresAt: number) {
    if (this.stopped || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return;
    this.expiresAt = expiresAt;
    this.current?.renew(expiresAt);
  }

  openMedia(viewId: string) { return this.current?.openMedia?.(viewId) ?? Promise.resolve(undefined); }

  // MultipathChannel owns and closes attached channels; only disable recreation here.
  stop() { this.stopped = true; }
}
