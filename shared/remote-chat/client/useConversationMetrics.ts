import { useEffect, useRef, useState } from 'react';
import {
  CONVERSATION_METRICS_REFRESH_MS, type ConversationMetrics, type ReadConversationMetrics,
} from '../conversationMetrics';

interface Snapshot { read: ReadConversationMetrics; threadId: string; metrics: ConversationMetrics | null }

export function useConversationMetrics(read: ReadConversationMetrics, threadId: string | null, active: boolean) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const pending = useRef(new WeakMap<ReadConversationMetrics, Set<string>>());
  useEffect(() => {
    setSnapshot(null);
    if (!active || !threadId) return;
    let disposed = false;
    const reading = pending.current.get(read) ?? new Set<string>();
    pending.current.set(read, reading);
    const refresh = async () => {
      if (disposed || reading.has(threadId)) return;
      reading.add(threadId);
      try {
        const metrics = await read(threadId);
        if (!disposed) setSnapshot({ read, threadId, metrics });
      } catch {
        if (!disposed) setSnapshot({ read, threadId, metrics: null });
      } finally {
        reading.delete(threadId);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), CONVERSATION_METRICS_REFRESH_MS);
    return () => { disposed = true; clearInterval(timer); };
  }, [read, threadId, active]);
  return active && snapshot?.read === read && snapshot.threadId === threadId ? snapshot.metrics : null;
}
