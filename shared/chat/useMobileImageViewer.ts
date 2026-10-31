import { useSyncExternalStore } from 'react';

// Match the fullscreen viewer's phone and touch layout, including landscape phones.
const MOBILE_VIEWER = '(max-width: 640px), (hover: none) and (pointer: coarse)';
const read = () => window.matchMedia(MOBILE_VIEWER).matches;
function subscribe(listener: () => void) {
  const media = window.matchMedia(MOBILE_VIEWER);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}

export function useMobileImageViewer() {
  return useSyncExternalStore(subscribe, read, () => false);
}
