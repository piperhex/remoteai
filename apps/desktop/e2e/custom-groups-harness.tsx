import { useEffect, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigProvider, theme } from 'antd';
import { ThreadSidebar } from '../src/pages/codexGui/ThreadSidebar';
import { RemoteGuiSidebar } from '../src/pages/codexGui/remote/RemoteGuiSidebar';
import { ChatThreads } from '../../web/src/chat/ChatThreads';
import type { GuiController } from '../src/pages/codexGui/controller';
import { initialState } from '../src/pages/codexGui/preferences';
import { createGuiGroups } from '../src/pages/codexGui/groupActions';
import { guiApi } from '../src/pages/codexGui/api';
import { SidebarBridge } from '../src/pages/codexGui/sidebarBridge';
import { ChatController } from '../../../shared/remote-chat/client/controller';
import { setInterfaceLanguage } from '../../../shared/localization/interfaceLanguage';
import styles from '../src/pages/codexGui/styles.module.less';
import 'antd/dist/reset.css';
import '../src/styles.css';
import '../../web/src/chat/chat.css';
import '../../web/src/chat/thread-actions.css';

const params = new URLSearchParams(location.search);
setInterfaceLanguage((params.get('lang') ?? 'zh') as 'zh');
document.body.style.minWidth = '0';
const dark = params.has('dark');
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
const threads = [
  { id: 'design', name: '分组设计讨论', preview: '', cwd: '/workspace/remote-ai', updatedAt: 3 },
  { id: 'release', name: '发布检查清单', preview: '', cwd: '/workspace/remote-ai', updatedAt: 2 },
  { id: 'research', name: '交互体验研究', preview: '', cwd: '/workspace/research', updatedAt: 1 },
];
let state = { ...initialState(), connection: 'ready' as const, threads };
if (!state.grouping.groups.length && !localStorage.getItem('custom-group-fixture-initialized')) {
  state.grouping.groups = [{ id: 'work', name: '工作', parentId: null },
    { id: 'client', name: '客户端', parentId: 'work' }, { id: 'research', name: '研究', parentId: null }];
  localStorage.setItem('custom-group-fixture-initialized', '1');
  localStorage.setItem('codex-switch:gui-custom-groups', JSON.stringify(state.grouping));
}
const listeners = new Set<() => void>();
const patch = (value: Partial<typeof state>) => { state = { ...state, ...value }; listeners.forEach(listener => listener()); };
guiApi.request = async request => (request.operation === 'list'
  ? { data: request.archived ? [] : threads, nextCursor: null } : {}) as never;
const local = { getSnapshot: () => state, subscribe: (listener: () => void) => {
  listeners.add(listener); return () => { listeners.delete(listener); };
}, groups: createGuiGroups({ snapshot: () => state, patch }), readState: { markRemoteRead() {} },
refresh: async () => {}, filter: (_: string, archived: boolean) => patch({ archived }),
pin() {}, newConversation() {}, setProject() {}, select: async () => {},
projectActions: { pin() {}, remove: async () => true },
} as unknown as GuiController;
if (params.has('failure')) {
  local.groups.members = async () => {
    const delay = Number(params.get('delay') ?? 0);
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    throw new Error(params.get('failure') === 'legacy' ? '当前手机端暂不支持此操作。' : 'fixture load failed');
  };
}
const bridge = new SidebarBridge(); bridge.attach(local);
const remote = new ChatController(events => ({
  start() { events.mode('relay'); events.ready(); }, stop() {},
  async request<T>(method: string, value?: unknown): Promise<T> {
    if (method === 'connect') return [] as T;
    const body = value as { operation: string; action?: string; mutation?: Parameters<typeof local.groups.mutate>[0] };
    if (body.operation === 'list') return { data: threads, nextCursor: null, sidebar: bridge.snapshot() } as T;
    if (body.operation === 'guiGroups') {
      if (body.action === 'members') return await local.groups.members() as T;
      await local.groups.mutate(body.mutation!); return bridge.snapshot() as T;
    }
    return { data: [], nextCursor: null } as T;
  },
}));

function Harness() {
  const localState = useSyncExternalStore(local.subscribe, local.getSnapshot);
  const remoteState = useSyncExternalStore(remote.subscribe, remote.snapshot);
  useEffect(() => { remote.start(); return () => remote.stop(); }, []);
  const mode = params.get('mode') ?? 'local';
  const focusMode = { focused: false, onToggleFocus() {} };
  const actions = { newChat() {}, onClose() {}, openSearch() {} };
  return <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: { motion: false } }}><App>
    <main className={mode === 'web' ? 'chat-page' : styles.page} style={{ height: '100vh', display: 'flex' }}>
      {mode === 'local' ? <ThreadSidebar state={localState} controller={local} accountPicker={null} {...focusMode} />
        : mode === 'remote' ? <RemoteGuiSidebar state={remoteState} controller={remote} actions={actions}
          focusMode={focusMode} accountPicker={null} />
          : <aside className="chat-sidebar" style={{ flexBasis: 320 }}><ChatThreads state={remoteState} controller={remote}
            {...actions} profile={null} /></aside>}
      <section style={{ padding: 32, flex: 1 }}><h2>Codex GUI</h2><p>分组与项目</p></section>
    </main>
  </App></ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
