// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { ChatOperations } from './operations';
import { guiApi } from '../../../../shared/conversation/api';
import { summarizeProcesses } from '../../../../shared/conversation/processDetails';
import { summarizeCommands } from '../../../../shared/remote-chat/commandMetrics';
import { applyHistoryDelta } from '../../../../shared/remote-chat/historySync';
import type { PagedHistoryDelta } from '../../../../shared/remote-chat/historyPage';
import { processMergeSource } from '../../e2e/process-merge-fixture';

vi.mock('../api/backend', () => ({ invoke: vi.fn(), hasLocalBackend: false, isDesktopApp: false }));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));
vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn() } }));

it.each(['direct', 'relay'] as const)('syncs folded %s history and serves legacy raw readers', async mode => {
  const raw = processMergeSource('reasoning');
  const snapshot = summarizeProcesses(raw);
  vi.mocked(guiApi.request).mockImplementation(async request => ({ thread:
    'includeToolDetails' in request && request.includeToolDetails ? raw : snapshot }) as never);
  const host = new ChatOperations();
  let sequence = 0;
  try {
    host.prepareEvent({ method: 'turn/completed', params: { threadId: raw.id, turn: raw.turns![0] } });
    for (const deferred of [true, true, false]) {
      const response = await host.execute({ kind: 'request', id: `merge:${mode}:${++sequence}`,
        method: 'request', body: { operation: 'syncHistory', threadId: raw.id, deferToolDetails: deferred,
          window: { deferProcesses: deferred } } }, mode);
      expect(response.error).toBeUndefined();
      const thread = applyHistoryDelta({ ...raw, turns: [] }, response.data as PagedHistoryDelta);
      expect(summarizeCommands(thread.turns!)).toEqual({ successfulCommandCount: 2, completedCommandCount: 2 });
      expect(thread.turns![0].items.map(item => item.type)).toEqual((deferred ? snapshot : raw)
        .turns![0].items.map(item => item.type));
    }
  } finally { host.release(); }
});
