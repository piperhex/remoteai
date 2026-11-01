import { useCallback, useLayoutEffect, useRef } from 'react';

/** Stable event identity with the latest committed closure, never a speculative render's state. */
export function useCommittedCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const committed = useRef(callback);
  useLayoutEffect(() => { committed.current = callback; });
  return useCallback((...args: Args) => committed.current(...args), []);
}
