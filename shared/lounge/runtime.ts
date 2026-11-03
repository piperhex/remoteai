/** Platform lifecycle used by the persistent chat connection. */
export interface LoungeRuntime {
  retryRandom?: () => number;
  isVisible: () => boolean;
  subscribe: (wake: () => void) => () => void;
  randomId: () => string;
}

export const browserLoungeRuntime: LoungeRuntime = {
  isVisible: () => document.visibilityState === 'visible' && document.hasFocus(),
  randomId: () => crypto.randomUUID(),
  subscribe(wake) {
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  },
};
