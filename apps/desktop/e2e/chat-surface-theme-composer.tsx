import { useState } from 'react';
import { ChatComposer } from '../../../shared/remote-chat/views/ChatComposer';
import { ChatConnectionAction } from '../../../shared/remote-chat/views/ChatConnectionAction';
import { SkillInput } from '../src/pages/codexGui/SkillInput';
import { MessageEditContext } from '../src/pages/codexGui/messageEditContext';
import type { ComposerText } from '../../../shared/conversation/types';
import { testModels } from '../../../shared/conversation/testing/models';
import { loadSurfaceSkills, surfaceSkills } from './chat-surface-theme-fixture';

const noop = () => {};
export function RemoteSurfaceComposer({ chooseDevice }: { chooseDevice: () => void }) {
  return <ChatComposer models={testModels} selection={{ model: 'gpt-test', effort: 'high', access: 'workspace-write' }}
    threadId="theme-test" active ready sending={false} running={false} settingsBusy={false} settingsError=""
    compacting={false} compactReason="请等待当前任务结束" goalBusy={false} cwd="/project"
    updateSettings={async () => {}} refreshModels={async () => {}} interrupt={async () => {}}
    compact={async () => true}
    goals={{ load: async () => {}, clear: async () => true }}
    contextSettings={{ read: async () => ({ capacity: null }), write: async (_id, value) => value }}
    catalog={{ skills: surfaceSkills, loaded: true, loading: false, error: '', refresh: noop }}
    loadFiles={async () => ({ directory: '/project', parent: null, entries: [], truncated: false })}
    loadCatalog={async () => ({ ...await loadSurfaceSkills(), plugins: [] })}
    loadConversations={async () => ({ data: [], nextCursor: null })}
    readUsage={async () => ({ totalTokens: 0, estimatedCostUsd: 0, primaryRemainingPercent: null,
      primaryRemainingAggregated: false, providerEstimatedCost: null })}
    readConversationMetrics={async () => ({ totalOutputTokens: 0, totalOutputTimeMs: 0, outputRequestCount: 0 })}
    connectionInfo={<ChatConnectionAction className="chat-connection-name" label="选择电脑" onClick={chooseDevice}>
      Office PC</ChatConnectionAction>}
    connection={{ deviceName: 'Office PC', chooseDevice, client: {
      read: async () => ({ running: true, choices: [], selection: { kind: 'none' } }),
      select: async selection => selection, subscribe: () => noop,
    } }} send={async () => true} />;
}

export function LocalSurfaceComposer() {
  const [draft, setDraft] = useState<ComposerText>({ text: '', mentions: [] });
  return <MessageEditContext.Provider value={{ cwd: '/project', active: true, loadSkills: loadSurfaceSkills }}>
    <SkillInput value={draft} draftKey="theme-test" cwd="/project" active connected disabled={false}
      placeholder="输入消息" onChange={setDraft} onPaste={noop} onSend={noop}
      compact={{ enabled: false, description: '请等待当前任务结束', percent: null, run: noop }}
      goal={{ enabled: true, run: noop }} />
  </MessageEditContext.Provider>;
}
