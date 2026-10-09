import { useEffect, useState } from 'react';
import type { Turn } from './types';

const SECOND_MS = 1000;

/** Use the PC timestamp when available and retain a fallback across streaming renders. */
export function useProcessingSeconds(turn: Turn | undefined, active = true,
  startedAtMs?: number, pendingStartedAtMs?: number) {
  const id = turn?.id ?? pendingStartedAtMs;
  const [clock, setClock] = useState(() => ({ id, start: Date.now(), now: Date.now() }));
  const running = turn?.status === 'inProgress' || (!turn && pendingStartedAtMs != null);
  useEffect(() => {
    if (!running || !active) return;
    const tick = () => setClock((previous) => {
      const now = Date.now();
      return { id, start: previous.id === id ? previous.start : now, now };
    });
    tick();
    const timer = setInterval(tick, SECOND_MS);
    return () => clearInterval(timer);
  }, [id, running, active, startedAtMs]);
  const turnStart = turn?.startedAt == null ? pendingStartedAtMs ?? clock.start : turn.startedAt * SECOND_MS;
  const elapsed = (start: number) => Math.max(0, Math.floor((clock.now - start) / SECOND_MS));
  return { phaseSeconds: elapsed(startedAtMs ?? turnStart), totalSeconds: elapsed(turnStart) };
}
