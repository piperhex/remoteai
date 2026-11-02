import { useEffect, useRef, useState } from 'react';
import { useStatusRefreshMinutes } from './preferences';
import { serviceHealth, type CodexServiceStatus, type ReadCodexServiceStatus } from './status';

export function useCodexServiceStatus(read: ReadCodexServiceStatus | undefined, active: boolean) {
  const minutes = useStatusRefreshMinutes();
  const pending = useRef(new Map<ReadCodexServiceStatus, Promise<CodexServiceStatus>>());
  const [snapshot, setSnapshot] = useState<{ read: ReadCodexServiceStatus; value?: CodexServiceStatus }>();
  useEffect(() => {
    if (!active || !read) return;
    let stopped = false;
    let refreshing = false;
    const refresh = async () => {
      if (document.hidden || refreshing) return;
      refreshing = true;
      const request = pending.current.get(read) ?? Promise.resolve().then(read);
      pending.current.set(read, request);
      try {
        const value = await request;
        if (!stopped) setSnapshot({ read, value });
      } catch {
        if (!stopped) setSnapshot({ read });
      } finally { pending.current.delete(read); refreshing = false; }
    };
    const visible = () => { if (!document.hidden) void refresh(); };
    void refresh();
    const timer = setInterval(() => void refresh(), minutes * 60_000);
    document.addEventListener('visibilitychange', visible);
    return () => {
      stopped = true; clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [read, active, minutes]);
  return serviceHealth(active && snapshot?.read === read ? snapshot?.value : undefined);
}
