import { useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from 'antd';
import { ChatController } from '../../../shared/remote-chat/client/controller';
import { historyDelta } from '../../../shared/remote-chat/historySync';
import type { Thread } from '../src/chat/types';
import { ChatThreads } from '../src/chat/ChatThreads';
import { ChatSidebar } from '../src/chat/ChatSidebar';
import { ChatThreadFilter } from '../src/chat/ChatThreadFilter';
import { RemoteGuiSidebar } from '../../desktop/src/pages/codexGui/remote/RemoteGuiSidebar';
import { ThreadSidebar } from '../../desktop/src/pages/codexGui/ThreadSidebar';
import { GuiController } from '../../desktop/src/pages/codexGui/controller';
import { guiApi } from '../../desktop/src/pages/codexGui/api';
import styles from '../../desktop/src/pages/codexGui/styles.module.less';
import '../src/styles.css';
import '../src/chat/chat.css';

function createController() {
  return new ChatController(events => ({
    start() { events.mode('relay'); events.ready(); }, stop() {},
    async request<T>(method: string, body?: unknown): Promise<T> {
      if (method === 'connect') return [] as T;
      const input = body as { operation: string; threadId?: string };
      if (input.operation === 'models') return { data: [{ id: 'model', model: 'model', displayName: 'Model',
        supportedReasoningEfforts: [], defaultReasoningEffort: 'medium' }], nextCursor: null } as T;
      if (['list', 'rename', 'archive', 'unarchive', 'delete', 'threadPin', 'forkLatest', 'guiFileAction',
        'guiProjectPin', 'guiProjectRemove', 'projectDirectories'].includes(input.operation)) {
        const response = await fetch('/web/thread-action', { method: 'POST', body: JSON.stringify(input) });
        if (!response.ok) throw new Error('操作未完成，请稍后重试。');
        return response.json();
      }
      if (input.operation === 'syncHistory') return historyDelta({ id: input.threadId, preview: '', cwd: '/project',
        updatedAt: 1, turns: [] } as Thread) as T;
      return { data: [], nextCursor: null } as T;
    },
  }));
}

function Harness() {
  const [controller] = useState(createController);
  const [open, setOpen] = useState(true);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const mode = new URLSearchParams(location.search).get('sidebar');
  useEffect(() => { controller.start(); return () => controller.stop(); }, [controller]);
  if (mode === 'local') return <LocalSidebar />;
  if (mode === 'remote') return <main className={`${styles.page} chat-diff-layout`} style={{ height: '100dvh' }}>
    <RemoteGuiSidebar state={state} controller={controller} accountPicker={null}
      actions={{ newChat() {}, onClose() {}, openSearch() {} }} focusMode={{ focused: false, onToggleFocus() {} }} />
    <output data-testid="selected">{state.selected?.id ?? 'none'}</output>
  </main>;
  return <main className="chat-page" style={{ height: '100dvh' }}>
    <output data-testid="selected">{state.selected?.id ?? 'none'}</output>
    <button type="button" onClick={() => setOpen(true)}>打开列表</button>
    <ChatSidebar desktop={window.innerWidth > 860} open={open} onClose={() => setOpen(false)}
      headingExtra={<ChatThreadFilter state={state} controller={controller} />}>
      <ChatThreads state={state} controller={controller} newChat={() => {}} onClose={() => {}}
        openSearch={() => {}} profile={null} />
    </ChatSidebar>
  </main>;
}

function LocalSidebar() {
  const [controller] = useState(() => {
    guiApi.request = async body => {
      const response = await fetch('/web/thread-action', { method: 'POST', body: JSON.stringify(body) });
      return response.json();
    };
    const local = new GuiController();
    Object.assign(local.getSnapshot(), { connection: 'ready' });
    return local;
  });
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => { void controller.refresh(); return () => controller.dispose(); }, [controller]);
  return <main className={styles.page} style={{ height: '100dvh' }}>
    <ThreadSidebar state={state} controller={controller} accountPicker={null}
      focused={false} onToggleFocus={() => {}} />
    <output data-testid="selected">{state.selected ?? 'none'}</output>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App><Harness /></App>);
