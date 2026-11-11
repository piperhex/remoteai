import { useMemo } from 'react';
import type { Conversation } from '../../../../../shared/conversation/types';
import type { CliMessagesProps } from '../../../../../shared/cli-gui/CliMessages';
import { cliThread } from '../../../../../shared/cli-gui/presentation';
import { Messages } from './Messages';
import { RunningChangesSummary } from './RunningChangesSummary';

/** Keep the local GUI's welcome, message viewport and sticky composer for every engine. */
export function CliLocalMessages({ history, selected, footer, active, loadOlder }: CliMessagesProps) {
  const value = useMemo<Conversation | undefined>(() => {
    const thread = cliThread(history);
    if (!thread || !history) return undefined;
    const turns = thread.turns ?? [];
    return { thread, turns, activeTurn: turns.find(turn => turn.status === 'inProgress')?.id ?? null,
      tokens: 0, error: '',
      historyPage: { hasMore: history.hasOlder } };
  }, [history]);
  return <Messages selected={selected} value={value} active={active} canUndoChanges={false}
    footer={<><RunningChangesSummary value={value} />{footer}</>}
    onLoadOlder={async () => { await loadOlder(); return undefined; }} />;
}
