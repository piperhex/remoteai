import { invoke } from '@tauri-apps/api/core';

interface Request {
  url: string; headers: Record<string, string>; headerOrigin: string; visible: boolean; navigate: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

/** Serialize resize/navigation work and close only after pending native creation completes. */
export function nativeBrowserSession(id: string, onError: (reason: unknown) => void) {
  let pending: Request | undefined;
  let flight: Promise<void> | undefined;
  let closed = false;
  let lastUrl = '';
  const flush = async () => {
    while (pending && !closed) {
      const request = pending; pending = undefined;
      try {
        await invoke('provider_browser_sync', { request: { ...request, id,
          navigate: request.navigate && request.url !== lastUrl } });
        if (request.visible) lastUrl = request.url;
      } catch (reason) { pending = undefined; if (!closed) onError(reason); }
    }
  };
  return {
    update: (request: Request) => {
      if (closed) return;
      pending = request;
      if (!flight) flight = flush().finally(() => { flight = undefined; });
    },
    close: async () => { closed = true; pending = undefined; await flight;
      await invoke('provider_browser_close', { id }); },
  };
}
