export interface ReconnectBackoffOptions {
  initialMs?: number;
  maximumMs?: number;
  random?: () => number;
}

/** Equal jitter keeps retries apart without allowing a zero-delay failure loop. */
export class ReconnectBackoff {
  private ceiling: number;
  private readonly initial: number;
  private readonly maximum: number;
  private readonly random: () => number;

  constructor(options: ReconnectBackoffOptions = {}) {
    this.initial = options.initialMs ?? 1000;
    this.maximum = options.maximumMs ?? 30_000;
    this.random = options.random ?? Math.random;
    this.ceiling = Math.min(this.initial, this.maximum);
  }

  next() {
    const ceiling = this.ceiling;
    this.ceiling = Math.min(this.maximum, ceiling * 2);
    const sample = this.random();
    const fraction = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0.5;
    return Math.ceil(ceiling * (0.5 + fraction / 2));
  }

  /** Call after application authentication, never just because TCP/WebSocket opened. */
  reset() { this.ceiling = Math.min(this.initial, this.maximum); }
}
