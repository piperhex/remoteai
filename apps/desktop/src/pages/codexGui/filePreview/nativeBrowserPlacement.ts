import { invoke } from '@tauri-apps/api/core';

interface Placement {
  threadId?: string; tabId: string; visible: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}
const placements = new Map<string, Promise<void>>();

/** Serialize placement and cleanup across remounts so an old request cannot reveal a hidden tab. */
export function placeBrowser(request: Placement): Promise<void> {
  const previous = placements.get(request.tabId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => invoke<void>('codex_gui_browser_place', { request }));
  placements.set(request.tabId, next);
  const cleanup = () => { if (placements.get(request.tabId) === next) placements.delete(request.tabId); };
  void next.then(cleanup, cleanup);
  return next;
}
