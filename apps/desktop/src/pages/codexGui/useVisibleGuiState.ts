import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { GuiController } from './controller';

const subscribeVisibility = (listener: () => void) => {
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
};
const isVisible = () => document.visibilityState !== 'hidden';

/** Suspend presentation only; the shared controller, queue and remote host continue receiving events. */
export function useVisibleGuiState(controller: GuiController, active: boolean) {
  const visible = useSyncExternalStore(subscribeVisibility, isVisible);
  const enabled = active && visible;
  const last = useRef(controller.getSnapshot());
  const subscribe = useCallback((listener: () => void) =>
    enabled ? controller.subscribe(listener) : () => {}, [controller, enabled]);
  const snapshot = useCallback(() => {
    if (enabled) last.current = controller.getSnapshot();
    else if (Object.keys(last.current.conversations).some(id => id !== last.current.selected)
      || Object.keys(last.current.queued).length
      || last.current.approvals.length) {
      // Retain only the displayed conversation so navigation preserves its bounded message window.
      // Other histories and queued attachments must remain eligible for controller eviction.
      const { selected, conversations } = last.current;
      const current = selected ? conversations[selected] : undefined;
      last.current = { ...last.current, conversations: selected && current ? { [selected]: current } : {},
        queued: {}, approvals: [] };
    }
    return last.current;
  }, [controller, enabled]);
  return { state: useSyncExternalStore(subscribe, snapshot), visible: enabled };
}
