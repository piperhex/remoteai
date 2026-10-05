export interface DownloadMeasurements {
  usefulBytes: number; wireBytes: number; windowWaitMs: number; transportWaitMs: number;
  prepareMs: number; verifyMs: number; storageMs: number; saveMs: number; totalMs: number;
}

const RECENT_LIMIT = 32;
const recent: DownloadMeasurements[] = [];
const rpcSamples: number[] = [];
export function recordDownloadRpcLatency(ms: number) {
  rpcSamples.push(ms);
  if (rpcSamples.length > 512) rpcSamples.shift();
}
export function downloadRpcLatencies() {
  const sorted = [...rpcSamples].sort((a, b) => a - b);
  const percentile = (fraction: number) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
  return { samples: sorted.length, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) };
}
/** Bounded local diagnostics for benchmarks; no file identities or content are included. */
export const recentDownloadMeasurements = () => recent.map(value => ({ ...value }));

/** Local measurements contain no names, paths, credentials or file hashes. */
export class DownloadMetrics {
  private readonly started = performance.now();
  private readonly values: DownloadMeasurements = {
    usefulBytes: 0, wireBytes: 0, windowWaitMs: 0, transportWaitMs: 0,
    prepareMs: 0, verifyMs: 0, storageMs: 0, saveMs: 0, totalMs: 0,
  };
  add(metric: keyof DownloadMeasurements, value: number) {
    if (Number.isFinite(value) && value >= 0) this.values[metric] += value;
  }
  async measure<T>(metric: keyof DownloadMeasurements, operation: () => Promise<T>) {
    const start = performance.now();
    try { return await operation(); } finally { this.add(metric, performance.now() - start); }
  }
  snapshot(): DownloadMeasurements { return { ...this.values, totalMs: performance.now() - this.started }; }
  record() {
    recent.push(this.snapshot());
    if (recent.length > RECENT_LIMIT) recent.shift();
  }
}
