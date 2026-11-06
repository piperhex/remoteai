import { LiveHistory } from '../src/remoteChat/liveHistory';
import { summarizeProcesses } from '../../../shared/conversation/processDetails';
import { summarizeTools } from '../../../shared/conversation/toolDetails';
import { sliceHistory } from '../../../shared/remote-chat/historyPage';
import { summarizeCommands } from '../../../shared/remote-chat/commandMetrics';
import type { Thread } from '../../../shared/conversation/types';

export async function readCachedProcess(raw: Thread, mode: string) {
  const snapshot = summarizeProcesses(raw);
  const live = new LiveHistory();
  live.receive({ method: 'turn/completed', params: { threadId: raw.id, turn: raw.turns![0] } });
  let merged = snapshot;
  // Exercise repeated host synchronization before displaying the browser's process disclosure.
  if (mode !== 'local') for (let sync = 0; sync < 2; sync++) {
    merged = await live.read(raw.id, async () => ({ thread: snapshot }));
  }
  const result = sliceHistory(summarizeTools(merged), { deferProcesses: true });
  return { ...result, commandMetrics: summarizeCommands(result.thread.turns!) };
}
