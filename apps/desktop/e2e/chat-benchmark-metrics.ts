/** Includes IPC serialization and other main-thread work that synchronous call timings miss. */
export function eventLoopProbe() {
  const interval = 10;
  let last = performance.now(), maximum = 0;
  const timer = setInterval(() => {
    const now = performance.now(); maximum = Math.max(maximum, now - last - interval); last = now;
  }, interval);
  return { stop: () => { clearInterval(timer); return maximum; } };
}
