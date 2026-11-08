import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigProvider, theme } from 'antd';
import { ThreadSidebar } from '../src/pages/codexGui/ThreadSidebar';
import { GuiController } from '../src/pages/codexGui/controller';
import { initialState } from '../src/pages/codexGui/preferences';
import { ChatController } from '../../../shared/remote-chat/client/controller';
import { initialChatState } from '../../../shared/remote-chat/client/types';
import { ChatThreads } from '../../../shared/remote-chat/views/ChatThreads';
import { ChatSidebar } from '../../../shared/remote-chat/views/ChatSidebar';
import { activityThreads, completedActivityThreads } from '../../../shared/testing/threadActivityFixture';
import '../../../shared/remote-chat/views/chat.css';
import '../src/styles.css';

const mode = new URLSearchParams(location.search).get('mode') ?? 'local';
const local = new GuiController();
const remote = new ChatController(() => ({ start() {}, stop() {},
  async request<T>() { return { data: [], nextCursor: null } as T; } }));

function Harness() {
  const [completed, setCompleted] = useState(false);
  const [custom, setCustom] = useState(false);
  const threads = completed ? completedActivityThreads() : activityThreads;
  const grouping = { groups: custom ? [{ id: 'custom', name: '自定义分组', parentId: null }] : [], projects: {},
    threads: custom ? Object.fromEntries(threads.map(thread => [thread.id, 'custom'])) : {} };
  useEffect(() => {
    Object.assign(window, { activityFixture: { complete: () => setCompleted(true), custom: () => setCustom(true) } });
    return () => { local.dispose(); remote.stop(); };
  }, []);
  return <ConfigProvider theme={{ algorithm: theme.compactAlgorithm,
    token: { fontSize: 14, motion: false } }}><App>
    {mode === 'local' ? <main style={{ display: 'flex', height: '100dvh' }}>
      <ThreadSidebar state={{ ...initialState(), connection: 'ready', threads, grouping }}
        controller={local} accountPicker={null} focused={false} onToggleFocus={() => {}} />
    </main> : <main className="chat-page" style={{ height: '100dvh' }}>
      <ChatSidebar desktop={window.innerWidth > 860} open onClose={() => {}}>
        <ChatThreads state={{ ...initialChatState(), ready: true, threads,
          sidebar: { revision: 1, threads: {}, readState: {}, grouping } }} controller={remote}
          newChat={() => {}} onClose={() => {}} openSearch={() => {}} profile={null} />
      </ChatSidebar>
    </main>}
  </App></ConfigProvider>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
