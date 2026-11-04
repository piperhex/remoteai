import { Composer } from '../src/pages/codexGui/Composer';
import { GuiController } from '../src/pages/codexGui/controller';
import { conversation } from '../../../shared/conversation/events';
import { ChatComposer } from '../../../shared/remote-chat/views/ChatComposer';
import type { ComposerProps } from '../../../shared/remote-chat/views/composerProps';
import { invoke } from '../src/api/backend';
import { initialSettings, settingsFixture } from '../../../shared/remote-chat/testing/settingsFixture';
import type { GuiState } from '../../../shared/conversation/types';
import { DesktopUsageContext } from '../../../shared/chat/DesktopUsageContext';
import { useVisibleChatUsage } from '../../../shared/remote-chat/views/useVisibleChatUsage';
import { QuotaAccountFixture } from './quota-account-fixture';

export const readQuota = () => invoke('codex_gui_usage_summary');
const noop = () => {};
const controller = new GuiController();
const thread = { id: 'quota-preview', cwd: '', preview: '', updatedAt: 1, turns: [] };
const localState: GuiState = {
  ...controller.getSnapshot(), connection: 'ready', selected: thread.id,
  threads: [thread], models: settingsFixture.models,
  settings: { ...controller.getSnapshot().settings, ...initialSettings },
  conversations: { [thread.id]: { ...conversation(thread), tokenUsage: settingsFixture.tokenUsage, tokens: 413180 } },
};
const remoteProps: ComposerProps = {
  ...settingsFixture, readUsage: readQuota, selection: initialSettings, threadId: thread.id,
  tokenUsage: { ...settingsFixture.tokenUsage, total: { totalTokens: 413180 } },
  readConversationMetrics: async () => ({ totalOutputTokens: 300, totalOutputTimeMs: 2000,
    outputRequestCount: 1, estimatedCostUsd: 12.34 }),
  active: true, ready: true, sending: false, running: false, settingsBusy: false, settingsError: '',
  compacting: false, compactReason: null, cwd: '',
  updateSettings: async () => {}, interrupt: async () => {}, compact: async () => true, send: async () => true,
  goals: { load: async () => {}, clear: async () => true },
  catalog: { skills: [], loaded: true, loading: false, error: '', refresh: noop },
  loadFiles: async () => ({ directory: '', parent: null, entries: [], truncated: false }),
  loadCatalog: async () => ({ data: [], plugins: [] }),
  loadConversations: async () => ({ data: [], nextCursor: null }),
};

export function QuotaComposerFixture({ local = false, web = false }: { local?: boolean; web?: boolean }) {
  const snapshot = useVisibleChatUsage(readQuota, true);
  return <DesktopUsageContext.Provider value={snapshot}>
    <div className="quota-account"><QuotaAccountFixture local={local} web={web} /></div>
    {local ? <Composer controller={controller} state={localState} active cliVersion="0.164.0" />
      : <ChatComposer {...remoteProps} cliVersion="0.164.0" />}
  </DesktopUsageContext.Provider>;
}
