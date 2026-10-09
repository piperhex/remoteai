import type { Turn } from '../../apps/desktop/src/pages/codexGui/types';

export interface TurnRetryTarget { threadId: string; turnId: string }

/** Only the latest terminal error can continue the current conversation. */
export function failedTurnTarget(threadId: string | undefined, turns: Turn[] = []): TurnRetryTarget | null {
  const turn = turns.at(-1);
  if (!threadId || !turn || turns.some(entry => entry.status === 'inProgress')) return null;
  if (turn.status !== 'failed' && !(turn.status === 'interrupted' && turn.error)) return null;
  return { threadId, turnId: turn.id };
}

export function sameRetryTarget(left: TurnRetryTarget | null, right: TurnRetryTarget): boolean {
  return left?.threadId === right.threadId && left.turnId === right.turnId;
}
