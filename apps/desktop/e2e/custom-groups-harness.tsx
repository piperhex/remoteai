import { useEffect, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigProvider, theme } from 'antd';
import { ThreadSidebar } from '../src/pages/codexGui/ThreadSidebar';
import { RemoteGuiSidebar } from '../src/pages/codexGui/remote/RemoteGuiSidebar';
import { ChatThreads } from '../../../shared/remote-chat/views/ChatThreads';
import type { GuiController } from '../src/pages/codexGui/controller';
import { initialState } from '../src/pages/codexGui/preferences';
import { createGuiGroups } from '../src/pages/codexGui/groupActions';
import { GuiProjects } from '../src/pages/codexGui/projectActions';
import { selectGuiProject } from '../src/pages/codexGui/projectSelection';
import { conversation } from '../../../shared/conversation/events';
import { guiApi } from '../../../shared/conversation/api';
import { SidebarBridge } from '../src/pages/codexGui/sidebarBridge';
import { ChatController } from '../../../shared/remote-chat/client/controller';
import { setInterfaceLanguage } from '../../../shared/localization/interfaceLanguage';
import { setThemeMode } from '../../web/src/theme/preference';
import { DEFAULT_THEME_COLOR } from '../../../shared/appearance/themeColor';
import styles from '../../../shared/conversation/styles.module.less';
import 'antd/dist/reset.css';
import '../src/styles.css';
import '../../../shared/remote-chat/views/chat.css';
import '../../../shared/remote-chat/views/thread-actions.css';
import { groupRequests, manyThreads, membersFixture, type FixtureThread } from './group-members-fixture';
import type { GroupMembersQuery } from '../../../shared/chat/groups/model';

const params = new URLSearchParams(location.search);
setInterfaceLanguage((params.get('lang') ?? 'zh') as 'zh');
document.body.style.minWidth = '0';
const dark = params.has('dark');
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
if (params.get('mode') === 'web') setThemeMode(dark ? 'dark' : 'light');
const threads = [
  { id: 'design', name: '分组设计讨论', preview: '', cwd: '/workspace/remote-ai', updatedAt: 3 },
  { id: 'release', name: '发布检查清单', preview: '', cwd: '/workspace/remote-ai', updatedAt: 2 },
  { id: 'research', name: '交互体验研究', preview: '', cwd: '/workspace/research', updatedAt: 1 },
  ...(params.has('restore') ? [{ id: 'loose', name: '无项目对话', preview: '', cwd: '', updatedAt: 1 }] : []),
];
const catalogThreads: FixtureThread[] = [...threads, ...(params.has('paging') ? manyThreads() : [])];
let state = { ...initialState(), connection: 'ready' as const, threads };
state.threads = threads.map(thread => ({ ...thread, cwd: state.projectOverrides[thread.id] ?? thread.cwd }));
if (!state.grouping.groups.length && !localStorage.getItem('custom-group-fixture-initialized')) {
  state.grouping.groups = [{ id: 'work', name: '工作', parentId: null },
    { id: 'client', name: '客户端', parentId: 'work' }, { id: 'research', name: '研究', parentId: null }];
  if (params.has('scroll')) {
    state.grouping.groups.push(...Array.from({ length: 35 }, (_, index) =>
      ({ id: `extra-${index}`, name: `Group ${index}`, parentId: null })));
    state.grouping.threads.design = 'work';
  }
  localStorage.setItem('custom-group-fixture-initialized', '1');
  if (params.has('restore')) {
    state.grouping.projects = { '/workspace/remote-ai': 'client' };
    state.grouping.threads = { design: 'research', release: null, loose: 'research' };
  }
  localStorage.setItem('codex-switch:gui-custom-groups', JSON.stringify(state.grouping));
}
const listeners = new Set<() => void>();
const patch = (value: Partial<typeof state>) => { state = { ...state, ...value }; listeners.forEach(listener => listener()); };
guiApi.request = async request => (request.operation === 'groupMembersPage'
  ? membersFixture(request, catalogThreads) : request.operation === 'list'
  ? { data: request.archived ? [] : state.threads, nextCursor: null }
  : request.operation === 'projectDirectories' ? { directory: request.directory, entries: [] } : {}) as never;
const local = { getSnapshot: () => state, subscribe: (listener: () => void) => {
  listeners.add(listener); return () => { listeners.delete(listener); };
}, groups: createGuiGroups({ snapshot: () => state, patch }), readState: { markRemoteRead() {} },
refresh: async () => {}, filter: (_: string, archived: boolean) => patch({ archived }),
pin() {}, newConversation() {}, setProject() {}, select: async (id: string) => patch({ selected: id }),
setWorkspaceBusy: (workspaceBusy: boolean) => patch({ workspaceBusy }),
retainConversation: () => () => {},
loadRemoteThread: async (id: string) => {
  const thread = state.threads.find(entry => entry.id === id)!;
  patch({ conversations: { ...state.conversations, [id]: conversation(thread) } });
},
projectActions: new GuiProjects({ getSnapshot: () => state, patch, report: error => { throw error; } }),
moveThreadToProject: async (threadId: string, cwd: string) => {
  await selectGuiProject(local, { threadId, cwd, removeFromGroup: true });
},
} as unknown as GuiController;
const fullMembers = local.groups.members;
local.groups.members = () => { groupRequests.full++; return fullMembers(); };
if (params.has('failure')) {
  const fail = async () => {
    const delay = Number(params.get('delay') ?? 0);
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    throw new Error(params.get('failure') === 'legacy' ? '当前手机端暂不支持此操作。' : 'fixture load failed');
  };
  local.groups.members = fail;
  local.groups.membersPage = fail;
}
const bridge = new SidebarBridge(); bridge.attach(local);
const remote = new ChatController(events => ({
  start() { events.mode('relay'); events.ready(); }, stop() {},
  async request<T>(method: string, value?: unknown): Promise<T> {
    if (method === 'connect') return [] as T;
    const body = value as { operation: string; action?: string; query?: GroupMembersQuery;
      mutation?: Parameters<typeof local.groups.mutate>[0] };
    if (body.operation === 'list') return { data: state.threads, nextCursor: null, sidebar: bridge.snapshot() } as T;
    if (body.operation === 'guiProjectSelect') {
      const project = await selectGuiProject(local, body);
      return { ...project, sidebar: bridge.snapshot() } as T;
    }
    if (body.operation === 'guiGroups') {
      if (body.action === 'members') return await local.groups.members() as T;
      if (body.action === 'membersPage') return await local.groups.membersPage!(body.query!) as T;
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
    token: { motion: false, colorPrimary: params.get('color') ?? DEFAULT_THEME_COLOR } }}><App>
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
