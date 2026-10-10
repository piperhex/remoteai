import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { TurnRetryTarget } from './turnRetry';

interface RetryAction { turnId: string; disabled: boolean; pending: boolean; retry: () => Promise<void> }
const Context = createContext<RetryAction | null>(null);
export type TurnRetrySubmission = boolean | { queueItemId: string };
interface SubmittedRetry { key: string; queueItemId?: string }

/** Unlock an acknowledged submission only when its queue item definitively fails or is cancelled. */
export function TurnRetryProvider({ target, disabled, onRetry, releasedQueueItemIds = [], children }: {
  target: TurnRetryTarget | null; disabled: boolean;
  onRetry: (target: TurnRetryTarget) => Promise<TurnRetrySubmission>; children: ReactNode;
  releasedQueueItemIds?: readonly string[];
}) {
  const key = target ? JSON.stringify([target.threadId, target.turnId]) : '';
  const inFlight = useRef('');
  const [pendingKey, setPendingKey] = useState('');
  const [submitted, setSubmitted] = useState<SubmittedRetry>();
  const released = submitted?.queueItemId && releasedQueueItemIds.includes(submitted.queueItemId);
  const pending = !!key && (pendingKey === key || (submitted?.key === key && !released));
  useEffect(() => {
    if (!released) return;
    // Terminal receipts may be evicted; only clear the submission that this receipt released.
    setSubmitted(current => current === submitted ? undefined : current);
  }, [released, submitted]);
  const retry = async () => {
    if (!target || disabled || pending || inFlight.current === key) return;
    inFlight.current = key;
    setPendingKey(key);
    try {
      const result = await onRetry(target);
      if (result) setSubmitted({ key, ...(typeof result === 'object' ? result : {}) });
    } finally {
      if (inFlight.current === key) inFlight.current = '';
      setPendingKey(current => current === key ? '' : current);
    }
  };
  const action = target ? { turnId: target.turnId, disabled: disabled || pending, pending, retry } : null;
  return <Context.Provider value={action}>
    {children}
  </Context.Provider>;
}

export function useTurnRetry(turnId: string) {
  const action = useContext(Context);
  return action?.turnId === turnId ? action : null;
}
