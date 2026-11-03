import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatComposer } from '../src/chat/ChatComposer';
import type { ComposerProps } from '../src/chat/composerProps';
import { initialChatState, type GuiEvent } from '../../../shared/remote-chat/client/types';
import { ChatController } from '../../../shared/remote-chat/client/controller';
import { GUI_ACCOUNT_SELECTION_EVENT } from '../../../shared/remote-chat/guiAccounts';
import { setLanguage } from '../src/i18n';
import { testModels } from '../../desktop/src/pages/codexGui/testModels';
import { setThemeMode } from '../src/theme/preference';
import 'antd-mobile/es/global';
import '../src/styles.css';

setThemeMode(new URLSearchParams(location.search).has('dark') ? 'dark' : 'light');
const state = { ...initialChatState(), ready: true, models: testModels,
  settings: { model: 'gpt-test', effort: 'high', access: 'workspace-write' as const },
  selected: { id: 'remote', cwd: '/project', preview: '', updatedAt: 1,
    turns: [{ id: 'turn', status: 'completed', items: [
      { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: '方案已准备好' },
    ] }] } };
const controller = new ChatController(events => {
  window.addEventListener('dictation-host-event', event => events.event((event as CustomEvent<GuiEvent>).detail));
  return { start() {}, stop() {}, request: async (_method, body) => {
    const response = await fetch('/web/test-dictation', { method: 'POST', body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  } };
});
const noop = () => {};
const base: Omit<ComposerProps, 'send'> = {
  dictation: controller.dictation, models: testModels, selection: state.settings, threadId: 'remote',
  active: true, ready: true, sending: false, running: false, settingsBusy: false, settingsError: '',
  compacting: false, compactReason: null, goalBusy: false, cwd: '/project',
  updateSettings: async () => {}, interrupt: async () => {}, compact: async () => true,
  goals: { load: async () => {}, clear: async () => true },
  contextSettings: { read: async () => ({ capacity: null }), write: async (_id, value) => value },
  catalog: { skills: [], loaded: true, loading: false, error: '', refresh: noop },
  loadFiles: async request => {
    const response = await fetch('/web/test-project-files', { method: 'POST', body: JSON.stringify(request) });
    return response.json();
  },
  loadCatalog: async () => ({ data: [], plugins: [] }), loadConversations: async () => ({ data: [], nextCursor: null }),
  readUsage: async () => ({ totalTokens: 0, estimatedCostUsd: 0, primaryRemainingPercent: null,
    primaryRemainingAggregated: false, providerEstimatedCost: null }),
  readConversationMetrics: async () => ({ totalOutputTokens: 0, totalOutputTimeMs: 0, outputRequestCount: 0 }),
  connection: { deviceName: '测试电脑', chooseDevice: noop, client: {
    read: async () => ({ running: true, choices: [], selection: { kind: 'none' } }),
    select: async selection => selection, subscribe: () => noop,
  } },
};
function Harness() {
  const [sent, setSent] = useState<string[]>([]);
  const [threadId, setThreadId] = useState('remote');
  const [ready, setReady] = useState(true);
  const [running, setRunning] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  return <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100dvh' }}>
    <output aria-label="已发送">{sent.join('\n')}</output>
    <div style={{ position: 'absolute', top: 0, left: 0 }}>
      <button onClick={() => setThreadId(value => value === 'remote' ? 'other' : 'remote')}>切换对话</button>
      <button onClick={() => setReady(value => !value)}>切换连接</button>
      <button onClick={() => setRunning(value => !value)}>切换运行</button>
      <button onClick={() => setInterrupted(value => !value)}>切换中断</button>
      <button onClick={() => window.dispatchEvent(new CustomEvent('dictation-host-event', {
        detail: { method: GUI_ACCOUNT_SELECTION_EVENT, params: {} },
      }))}>切换账户</button>
      <button onClick={() => setLanguage('en')}>English</button>
      <button onClick={() => setLanguage('ja')}>日本語</button>
      <button onClick={() => setLanguage('ru')}>Русский</button>
    </div>
    <ChatComposer {...base} threadId={threadId} ready={ready} running={running} interrupted={interrupted}
      interrupt={async () => { setRunning(false); setInterrupted(true); }} send={async input => {
      document.body.dataset.sent = JSON.stringify(input);
      setSent(values => [...values, input.text]); return true;
    }} />
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
