import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import type { TurnRetryTarget } from './turnRetry';

interface RetryAction { turnId: string; disabled: boolean; pending: boolean; retry: () => Promise<void> }
const Context = createContext<RetryAction | null>(null);

/** Keep successful submissions locked until history contains the new turn. */
export function TurnRetryProvider({ target, disabled, onRetry, children }: {
  target: TurnRetryTarget | null; disabled: boolean;
  onRetry: (target: TurnRetryTarget) => Promise<boolean>; children: ReactNode;
}) {
  const key = target ? JSON.stringify([target.threadId, target.turnId]) : '';
  const inFlight = useRef('');
  const [pendingKey, setPendingKey] = useState('');
  const [submittedKey, setSubmittedKey] = useState('');
  const pending = !!key && (pendingKey === key || submittedKey === key);
  const retry = async () => {
    if (!target || disabled || pending || inFlight.current === key) return;
    inFlight.current = key;
    setPendingKey(key);
    try {
      if (await onRetry(target)) setSubmittedKey(key);
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
