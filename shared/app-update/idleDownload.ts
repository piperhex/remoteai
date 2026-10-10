const IDLE_MS = 60_000;
const CHECK_INTERVAL_MS = 30_000;

/** Single-flight scheduler: activity postpones work; disposal prevents late asynchronous starts. */
export function idleDownload(options: {
  eligible(): Promise<boolean>; run(active: () => boolean): Promise<void>; now?: () => number;
}) {
  const now = options.now ?? Date.now;
  let touched = now();
  let running = false;
  let disposed = false;
  const active = () => !disposed && now() - touched >= IDLE_MS;
  const tick = async () => {
    if (running || !active()) return;
    running = true;
    try { if (await options.eligible() && active()) await options.run(active); }
    catch { /* Quietly retry after the next idle interval. */ }
    finally { running = false; touched = now(); }
  };
  const timer = setInterval(() => { void tick(); }, CHECK_INTERVAL_MS);
  return { touch: () => { touched = now(); }, dispose: () => { disposed = true; clearInterval(timer); } };
}
