import { guiText } from "../../i18n/guiText";
import { useGuiLanguage } from '../../i18n/useGuiLanguage';
import { useMemo, useState, type ReactNode } from "react";
import { App, Button, Dropdown, Input, Modal, Segmented, Spin } from "antd";
import { Archive, Pencil, Pin, RefreshCw, Search, Split, Trash2 } from "lucide-react";
import type { GuiController } from "./controller";
import type { GuiState, Thread } from "./types";
import { ThreadGroup } from "./ThreadGroup";
import { ThreadSearch } from "./ThreadSearch";
import { useThreadGroupViews } from "./useThreadGroupViews";
import { threadGroups } from "./threadGroups";
import { isThreadRunning } from "./threadRunning";
import { canForkLatestConversation } from "./forkConversation";
import { ProjectGroupMenu } from "./ProjectGroupMenu";
import { ThreadStatus } from "./ThreadStatus";
import { ThreadPagination } from "./ThreadPagination";
import { useThreadPagination } from "./useThreadPagination";
import { isDesktopApp } from "../../api/backend";
import { FocusModeButton, type GuiFocusMode } from "./FocusModeButton";
import { GuiNavigation, type GuiView } from "./GuiNavigation";
import styles from "./styles.module.less";

export function threadTitle(thread: Thread) { return thread.name || thread.preview || guiText("新对话"); }
export { projectName } from "./projectCatalog";

export function ThreadSidebar({ state, controller, accountPicker, focused, onToggleFocus,
  view = "conversation", onNavigate = () => {}, scheduledTasksAvailable = true }: {
  state: GuiState; controller: GuiController; accountPicker: ReactNode;
  view?: GuiView; onNavigate?: (view: GuiView) => void; scheduledTasksAvailable?: boolean;
} & GuiFocusMode) {
  const language = useGuiLanguage();
  const [searchOpen, setSearchOpen] = useState(false);
  const pagination = useThreadPagination({ state, controller, enabled: !searchOpen });
  const [renaming, setRenaming] = useState<Thread | null>(null);
  const [deleting, setDeleting] = useState<Thread | null>(null);
  const { message } = App.useApp();
  const [name, setName] = useState("");
  const { views, toggle } = useThreadGroupViews();
  const closeSearch = () => {
    setSearchOpen(false);
    if (state.search) controller.filter("", state.archived);
  };
  const groups = useMemo(() => threadGroups(state),
    [state.threads, state.pins, state.projects, state.pinnedProjects, state.conversations, state.pendingRequest, language]);
  const renderThread = (thread: Thread) => {
    const running = isThreadRunning(state, thread);
    const busy = state.sending || Boolean(state.deleting);
    const needsInput = state.approvals.some((event) => event.params.threadId === thread.id);
    const items = [
      { key: "pin", label: state.pins.includes(thread.id) ? guiText("取消置顶") : guiText("置顶"), icon: <Pin size={14} /> },
      { key: "rename", label: guiText("重命名"), icon: <Pencil size={14} />, disabled: running },
      { key: "fork", label: guiText("创建分支"), icon: <Split size={14} />,
        disabled: !canForkLatestConversation(state, thread) },
      { key: "archive", label: state.archived ? guiText("恢复对话") : guiText("归档"), icon: <Archive size={14} />, disabled: running },
      { key: "delete", label: guiText("删除"), icon: <Trash2 size={14} />, danger: true,
        disabled: running || busy || needsInput || Boolean(state.queued[thread.id]?.length)
          || state.connection !== "ready" },
    ];
    return <Dropdown key={thread.id} trigger={["contextMenu"]} overlayStyle={{ maxWidth: 400 }}
      menu={{ items, onClick: ({ key }) => {
        if (key === "pin") controller.pin(thread.id);
        if (key === "rename") { setRenaming(thread); setName(threadTitle(thread)); }
        if (key === "fork") { onNavigate("conversation"); void controller.forkConversation(thread.id); }
        if (key === "archive") void controller.manage(state.archived ? "unarchive" : "archive", thread.id);
        if (key === "delete") setDeleting(thread);
      } }}>
      <div className={[styles.thread,
        view === "conversation" && state.selected === thread.id ? styles.selected : ""].join(" ")}>
        <button className={styles.threadSelect} disabled={state.sending}
          onClick={() => { onNavigate("conversation"); void controller.select(thread.id); }}>
          <span className={styles.threadTitle}>{threadTitle(thread)}</span>
          <ThreadStatus running={running} needsInput={needsInput}
            unread={Boolean(state.threadReadState[thread.id]?.unread)} />
        </button>
      </div>
    </Dropdown>;
  };
  return <aside className={styles.sidebar}>
    <div className={styles.sidebarHeading} data-tauri-drag-region={isDesktopApp || undefined}>
      <h2 className={styles.sidebarTitle} data-tauri-drag-region={isDesktopApp || undefined}>Codex GUI</h2>
      <div className={styles.sidebarActions} data-tauri-drag-region={isDesktopApp || undefined}>
        <FocusModeButton focused={focused} onToggleFocus={onToggleFocus} />
        <Button type="text" size="small" icon={<RefreshCw size={15} />} aria-label={guiText("刷新对话")}
          loading={state.loading} disabled={state.connection !== "ready"} onClick={() => void controller.refresh()} />
        <Button type="text" size="small" icon={<Search size={15} />} aria-label={guiText("搜索对话")}
          disabled={state.connection !== "ready"} onClick={() => { onNavigate("conversation"); setSearchOpen(true); }} />
      </div>
    </div>
    <GuiNavigation view={view} sending={state.sending} onNavigate={onNavigate}
      scheduledTasksAvailable={scheduledTasksAvailable}
      onNewConversation={() => { onNavigate("conversation"); controller.newConversation(); }} />
    <Segmented className={styles.threadFilter} block size="small" value={state.archived ? "archived" : "recent"}
      options={[{ label: guiText("最近"), value: "recent" }, { label: guiText("已归档"), value: "archived" }]}
      onChange={(value) => controller.filter("", value === "archived")} disabled={state.connection !== "ready"} />
    <div className={styles.threadList} {...pagination}>
      {groups.map((group) => {
        const key = `${state.archived ? "archived" : "recent"}:${group.id}`;
        return <ThreadGroup key={key} label={group.label} pinned={group.pinned} threads={group.threads}
          selected={view === "conversation" ? state.selected : null}
          collapsed={views.collapsed.includes(key)} expanded={views.expanded.includes(key)}
          filtering={Boolean(state.search.trim())} onToggle={(field) => toggle(field, key)}
          projectPinned={state.pinnedProjects.includes(group.cwd)}
          projectMenu={group.cwd ? (heading) => <ProjectGroupMenu path={group.cwd} label={group.label}
            state={state} controller={controller}>{heading}</ProjectGroupMenu> : undefined}
          creatingDisabled={state.sending} onNewConversation={group.cwd ? () => {
            onNavigate("conversation");
            controller.newConversation();
            controller.setProject(group.cwd);
          } : undefined}
          renderThread={renderThread} />;
      })}
      {!state.threads.length && <p className={styles.listEmpty}>{state.loading ? <Spin size="small" /> : guiText("还没有对话")}</p>}
      {state.cursor && <ThreadPagination loading={state.loading} />}
    </div>
    {accountPicker}
    {searchOpen && <ThreadSearch state={state} controller={controller} onClose={closeSearch} />}
    <Modal title={guiText("删除这条对话？")} open={Boolean(deleting)} width={400} okText={guiText("移入回收站")} cancelText={guiText("取消")}
      confirmLoading={Boolean(state.deleting)} okButtonProps={{ danger: true }}
      closable={!state.deleting} maskClosable={!state.deleting} keyboard={!state.deleting}
      cancelButtonProps={{ disabled: Boolean(state.deleting) }}
      onCancel={() => { if (!state.deleting) setDeleting(null); }}
      onOk={async () => {
        if (deleting && await controller.deleteThread(deleting.id)) {
          setDeleting(null);
          void message.success(<span className="compact-confirm-copy">
            {guiText("已移入会话管理的回收站，可在那里恢复。")}</span>);
        }
      }}>
      <p className="compact-confirm-copy">{guiText("这条对话及其所有子对话将一起移入回收站，可在“会话管理”中恢复。")}</p>
    </Modal>
    <Modal title={guiText("重命名对话")} open={Boolean(renaming)} width={400} okText={guiText("保存")} cancelText={guiText("取消")}
      okButtonProps={{ disabled: !name.trim() }} onCancel={() => setRenaming(null)}
      onOk={() => { if (renaming) void controller.manage("rename", renaming.id, name); setRenaming(null); }}>
      <Input value={name} maxLength={120} autoFocus aria-label={guiText("对话名称")}
        onChange={(event) => setName(event.target.value)} />
    </Modal>
  </aside>;
}
