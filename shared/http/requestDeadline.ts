export const ADMIN_REQUEST_TIMEOUT_MS = 30_000;
export const SESSION_REFRESH_TIMEOUT_MS = 15_000;

/** Finite HTTP requests may explicitly use a larger budget (including body consumption). */
export interface DeadlineRequestInit extends RequestInit {
  timeoutMs?: number;
}

interface DeadlineOptions {
  signal?: AbortSignal | null;
  timeoutMs?: number;
  timeoutMessage: string;
}

export function throwIfAborted(signal?: AbortSignal | null): void {
  if (!signal?.aborted) return;
  const fallback = new Error();
  fallback.name = 'AbortError';
  throw signal.reason ?? fallback;
}

/** Cancels only this waiter; the underlying shared operation retains its own lifetime. */
export function waitWithSignal<T>(pending: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return pending;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      try { throwIfAborted(signal); } catch (error) { reject(error); }
    };
    signal.addEventListener('abort', abort, { once: true });
    // Attach handlers even when already aborted, so a late rejection is always observed.
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

/** Uses only AbortController/EventTarget APIs available in browsers and React Native. */
export async function withRequestDeadline<T>(
  options: DeadlineOptions, operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? ADMIN_REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs');
  throwIfAborted(options.signal);
  const controller = new AbortController();
  let failure: unknown;
  const forwardAbort = () => {
    try { throwIfAborted(options.signal); } catch (error) { failure = error; }
    controller.abort(failure);
  };
  options.signal?.addEventListener('abort', forwardAbort, { once: true });
  const timer = setTimeout(() => {
    const error = new Error(options.timeoutMessage);
    error.name = 'TimeoutError';
    failure = error;
    controller.abort(error);
  }, timeoutMs);
  try {
    return await waitWithSignal(operation(controller.signal), controller.signal);
  } catch (error) {
    // Older native AbortController implementations do not preserve signal.reason.
    throw controller.signal.aborted ? failure ?? error : error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}

/**
 * Admin endpoints return finite JSON/text. Drain a clone before exposing the original
 * Response so its metadata and body APIs stay intact, with no deadline left behind
 * when a caller needs only the status. Never use this helper for an unbounded stream;
 * consume such a stream inside withRequestDeadline with an explicit suitable budget.
 */
export async function fetchBufferedResponse(input: string, init: RequestInit): Promise<Response> {
  throwIfAborted(init.signal);
  const response = await fetch(input, init);
  throwIfAborted(init.signal);
  await response.clone().text();
  throwIfAborted(init.signal);
  return response;
}
