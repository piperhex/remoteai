import { uiText } from "../../../../../shared/localization/uiText";
import { useCliGui } from '../../../../../shared/cli-gui/context';
import { CliThreadRow } from '../../../../../shared/cli-gui/CliThreadRow';
import { useCliSidebar } from '../../../../../shared/cli-gui/useCliSidebar';
import { useGuiLanguage } from '../../../../../shared/localization/useGuiLanguage';
import { useMemo, useState, type ReactNode } from "react";
import { App, Button, Input, Modal, Segmented, Spin } from "antd";
import { ThreadContextMenu } from "../../../../../shared/chat/ThreadContextMenu";
import { Layers, RefreshCw, Search } from "lucide-react";
import { threadMenuItems } from "../../../../../shared/chat/threadMenuItems";
import type { GuiController } from "./controller";
import type { GuiState, Thread } from "../../../../../shared/conversation/types";
import { ThreadGroup } from "./ThreadGroup";
import { ThreadSearch } from "./ThreadSearch";
import { useThreadGroupViews } from "./useThreadGroupViews";
import { orderGuiThreads, threadGroups } from "./threadGroups";
import { isThreadRunning } from "./threadRunning";
import { canForkLatestConversation } from "./forkConversation";
import { ProjectGroupMenu } from "./ProjectGroupMenu";
import { ThreadStatus } from "./ThreadStatus";
import { ThreadPagination } from "./ThreadPagination";
import { ResizableThreadSidebar } from "./ResizableThreadSidebar";
import { useThreadPagination } from "./useThreadPagination";
import { isDesktopApp } from "../../api/backend";
import { fileApi } from "../../../../../shared/conversation/fileApi";
import { useOpenProjectFolder } from "../../../../../shared/chat/useOpenProjectFolder";
import { FocusModeButton, type GuiFocusMode } from "./FocusModeButton";
import { GuiNavigation, type GuiView } from "./GuiNavigation";
import styles from "../../../../../shared/conversation/styles.module.less";
import { BrowserGroups } from '../../../../../shared/chat/groups/BrowserGroups';
import { groupingTree, flattenGroupingTree } from '../../../../../shared/chat/groups/tree';
import { GroupHeading } from '../../../../../shared/chat/groups/GroupHeading';
import { useGrouping } from '../../../../../shared/chat/groups/context';

export function threadTitle(thread: Thread) { return thread.name || thread.preview || uiText("client.workspaceSettings.newConversation"); }
export { projectName } from "../../../../../shared/conversation/projectCatalog";

export function ThreadSidebar(props: Parameters<typeof ThreadSidebarContent>[0]) {
  return <BrowserGroups grouping={props.state.grouping} client={props.controller.groups}
    drag={{ enabled: !props.state.sending && !props.state.workspaceBusy && !props.state.removingProject,
      threadCwds: Object.fromEntries(props.state.threads.map(thread =>
        [thread.id, props.state.projectOverrides[thread.id] ?? thread.cwd])),
      canMoveThread: id => !props.state.goalBusy && props.state.compacting !== id && props.state.deleting !== id
        && !props.state.queued[id]?.length && !props.state.approvals.some(event => event.params.threadId === id)
        && !props.state.threads.some(thread => thread.id === id && isThreadRunning(props.state, thread)),
      moveThread: props.controller.moveThreadToProject }}
    translate={uiText} ready={props.state.connection === 'ready'}><ThreadSidebarContent {...props} /></BrowserGroups>;
}

function ThreadSidebarContent({ state, controller, accountPicker, focused, onToggleFocus,
  view = "conversation", onNavigate = () => {}, scheduledTasksAvailable = true }: {
  state: GuiState; controller: GuiController; accountPicker: ReactNode;
  view?: GuiView; onNavigate?: (view: GuiView) => void; scheduledTasksAvailable?: boolean;
} & GuiFocusMode) {
  const language = useGuiLanguage();
  const cli = useCliGui();
  const sidebar = useCliSidebar({ threads: state.threads, archived: state.archived, query: state.search });
  const grouping = useGrouping();
  const [searchOpen, setSearchOpen] = useState(false);
  const pagination = useThreadPagination({ state, controller, enabled: !searchOpen });
  const [renaming, setRenaming] = useState<Thread | null>(null);
  const [deleting, setDeleting] = useState<Thread | null>(null);
  const { message } = App.useApp();
  const openProject = useOpenProjectFolder(fileApi, uiText);
  const [name, setName] = useState("");
  const { views, toggle } = useThreadGroupViews();
  const closeSearch = () => {
    setSearchOpen(false);
    if (state.search) controller.filter("", state.archived);
  };
  const sections = useMemo(() => groupingTree(threadGroups({ ...state, threads: sidebar.threads })
    .map(group => ({ ...group, data: group.threads })),
    state.grouping), [sidebar.threads, state.pins, state.projects, state.pinnedProjects, state.conversations,
    state.pendingRequest, state.grouping, language]);
  const scope = state.archived ? 'archived' : 'recent';
  const collapsed = new Set(views.collapsed.filter(key => key.startsWith(`${scope}:`))
    .map(key => key.slice(scope.length + 1)));
  const groups = flattenGroupingTree(sections, state.search.trim() ? new Set() : collapsed)
    .map(group => ({ ...group, data: orderGuiThreads(group.data, state) }));
  const renderThread = (thread: Thread) => {
    const session = sidebar.session(thread);
    if (session) return <CliThreadRow key={thread.id} session={session} onSelect={() => onNavigate('conversation')} />;
    const running = isThreadRunning(state, thread);
    const busy = state.sending || Boolean(state.deleting);
    const needsInput = state.approvals.some((event) => event.params.threadId === thread.id);
    const items = threadMenuItems({ pinned: state.pins.includes(thread.id), archived: state.archived, translate: uiText,
      openProject: isDesktopApp && Boolean(thread.cwd),
      disabled: action => {
        if (action === 'pin') return false;
        if (action === 'fork') return !canForkLatestConversation(state, thread);
        if (action === 'delete') return running || busy || needsInput || Boolean(state.queued[thread.id]?.length)
          || state.connection !== 'ready';
        return running;
      } });
    return <ThreadContextMenu key={thread.id} groupTarget={{ kind: 'thread', id: thread.id }}
      menu={{ items, onClick: ({ key }) => {
        if (key === "pin") controller.pin(thread.id);
        if (key === "openProject") void openProject(thread.cwd);
        if (key === "rename") { setRenaming(thread); setName(threadTitle(thread)); }
        if (key === "fork") { onNavigate("conversation"); void controller.forkConversation(thread.id); }
        if (key === "archive") void controller.manage(state.archived ? "unarchive" : "archive", thread.id);
        if (key === "delete") setDeleting(thread);
      } }}>
      <div className={[styles.thread,
        view === "conversation" && state.selected === thread.id ? styles.selected : ""].join(" ")}>
        <button className={styles.threadSelect} disabled={state.sending}
          onClick={() => { cli?.controller.showCodex(); onNavigate("conversation"); void controller.select(thread.id); }}>
          <span className={styles.threadTitle}>{threadTitle(thread)}</span>
          <ThreadStatus running={running} needsInput={needsInput}
            unread={Boolean(state.threadReadState[thread.id]?.unread)} />
        </button>
      </div>
    </ThreadContextMenu>;
  };
  return <ResizableThreadSidebar>
    <div className={styles.sidebarHeading} data-tauri-drag-region={isDesktopApp || undefined}>
      <h2 className={styles.sidebarTitle} data-tauri-drag-region={isDesktopApp || undefined}>Codex GUI</h2>
      <div className={styles.sidebarActions} data-tauri-drag-region={isDesktopApp || undefined}>
        <Button type="text" size="small" icon={<Layers size={15} />} aria-label={uiText('client.groups.manage')}
          onClick={grouping?.openManager} />
        <FocusModeButton focused={focused} onToggleFocus={onToggleFocus} />
        <Button type="text" size="small" icon={<RefreshCw size={15} />} aria-label={uiText("client.workspaceActions.refreshConversations")}
          loading={state.loading} disabled={state.connection !== "ready"} onClick={() => void controller.refresh()} />
        <Button type="text" size="small" icon={<Search size={15} />} aria-label={uiText("client.workspaceActions.searchConversations")}
          disabled={state.connection !== "ready"} onClick={() => {
            cli?.controller.showCodex(); onNavigate("conversation"); setSearchOpen(true);
          }} />
      </div>
    </div>
    <GuiNavigation view={view} sending={state.sending || Boolean(cli?.state.busy)} onNavigate={next => {
      cli?.controller.showCodex(); onNavigate(next);
    }}
      scheduledTasksAvailable={scheduledTasksAvailable}
      onNewConversation={() => { cli?.controller.newConversation(); onNavigate("conversation"); controller.newConversation(); }} />
    <Segmented className={styles.threadFilter} block size="small" value={state.archived ? "archived" : "recent"}
      options={[{ label: uiText("client.chat.recent"), value: "recent" }, { label: uiText("client.mobile.archived"), value: "archived" }]}
      onChange={(value) => controller.filter("", value === "archived")} />
    <div className={styles.threadList} aria-busy={state.loading} {...pagination}>
      {groups.map((group) => {
        const key = `${state.archived ? "archived" : "recent"}:${group.id}`;
        const custom = group.kind === 'group';
        return <div key={key} style={{ paddingInlineStart: Math.min(group.depth, 8) * 14 }}>
          {custom && <GroupHeading id={group.id.slice('group:'.length)} label={group.label} icon={group.icon}
            collapsed={!state.search.trim() && collapsed.has(group.id)}
            toggle={() => toggle('collapsed', key)} />}
          <ThreadGroup label={group.label || uiText('client.groups.ungrouped')} pinned={Boolean(group.pinned)}
          hideHeading={custom} threads={group.data}
          selected={view === "conversation" ? sidebar.selected?.id ?? state.selected : null}
          collapsed={views.collapsed.includes(key)} expanded={views.expanded.includes(key)}
          filtering={Boolean(state.search.trim())} onToggle={(field) => toggle(field, key)}
          projectPinned={state.pinnedProjects.includes(group.cwd)}
          projectMenu={group.cwd ? (heading) => <ProjectGroupMenu path={group.cwd} label={group.label}
            state={state} controller={controller}>{heading}</ProjectGroupMenu> : undefined}
          creatingDisabled={state.sending} onNewConversation={group.cwd ? () => {
            cli?.controller.newConversation(); cli?.controller.patch({ cwd: group.cwd });
            onNavigate("conversation");
            controller.newConversation();
            controller.setProject(group.cwd);
          } : undefined}
          renderThread={renderThread} /></div>;
      })}
      {!sidebar.threads.length && <p className={styles.listEmpty}>{state.loading ? <Spin size="small" />
        : uiText(state.search ? "client.workspaceActions.noMatchingConversations" : "client.workspaceActions.noConversationsYet")}</p>}
      {state.cursor && <ThreadPagination loading={state.loading} />}
    </div>
    {accountPicker}
    {searchOpen && <ThreadSearch state={state} controller={controller} onClose={closeSearch} />}
    <Modal title={uiText("client.threadActions.deleteThisChat")} open={Boolean(deleting)} width={400} okText={uiText("client.workspaceActions.moveToTrash")} cancelText={uiText("client.accounts.cancel")}
      confirmLoading={Boolean(state.deleting)} okButtonProps={{ danger: true }}
      closable={!state.deleting} maskClosable={!state.deleting} keyboard={!state.deleting}
      cancelButtonProps={{ disabled: Boolean(state.deleting) }}
      onCancel={() => { if (!state.deleting) setDeleting(null); }}
      onOk={async () => {
        if (deleting && await controller.deleteThread(deleting.id)) {
          setDeleting(null);
          void message.success(<span className="compact-confirm-copy">
            {uiText("client.workspaceActions.movedToTheTrashInSessionsWhereYouCanRestore")}</span>);
        }
      }}>
      <p className="compact-confirm-copy">{uiText("client.workspaceActions.thisConversationAndAllItsChildConversationsWillMoveTo")}</p>
    </Modal>
    <Modal title={uiText("client.threadActions.renameChat")} open={Boolean(renaming)} width={400} okText={uiText("client.projectBrowser.save")} cancelText={uiText("client.accounts.cancel")}
      okButtonProps={{ disabled: !name.trim() }} onCancel={() => setRenaming(null)}
      onOk={() => { if (renaming) void controller.manage("rename", renaming.id, name); setRenaming(null); }}>
      <Input value={name} maxLength={120} autoFocus aria-label={uiText("client.threadActions.chatName")}
        onChange={(event) => setName(event.target.value)} />
    </Modal>
  </ResizableThreadSidebar>;
}
