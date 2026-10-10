import { guiText } from "../i18n/guiText";
import { useGuiLanguage } from '../i18n/useGuiLanguage';
import { DiffTextContext } from "../../../../shared/chat/diffText";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Alert, Button, Popover, Tooltip } from "antd";
import { PanelBottom, PanelLeftClose, PanelLeftOpen, RefreshCw } from "lucide-react";
import { canManageCodexConnection, hasLocalBackend, isDesktopApp } from "../api/backend";
import { getGuiController, retainGuiSession } from "./codexGui/session";
import { canEditMessage } from "./codexGui/editMessage";
import { canForkConversation } from "./codexGui/forkConversation";
import { ThreadSidebar, threadTitle } from "./codexGui/ThreadSidebar";
import { Composer, type ComposerHandle } from "./codexGui/Composer";
import { Messages } from "./codexGui/Messages";
import { ConversationRetryProvider } from "./codexGui/ConversationRetryProvider";
import { Approvals } from "./codexGui/Approvals";
import { AsyncQuestions } from "./codexGui/AsyncQuestions";
import { Installer } from "./codexGui/Installer";
import { CliUpdateIcon } from "./codexGui/CliUpdateIcon";
import { GuiSetupAlerts } from "./codexGui/GuiSetupAlerts";
import { useCliInstaller } from "./codexGui/useCliInstaller";
import { DetailsWorkspace } from "./codexGui/DetailsWorkspace";
import { ConversationChangesButton } from "./codexGui/ConversationChangesButton";
import { useGuiLayout } from "./codexGui/useGuiLayout";
import { useConversationReadState } from "./codexGui/useConversationReadState";
import { useTitleSettings } from "./codexGui/useTitleSettings";
import styles from "./codexGui/styles.module.less";
import { WorkspaceOperationContext } from "./codexGui/workspaceOperationContext";
import type { AggregateApi, Provider } from "../types";
import { useDreamSkin } from "./codexGui/useDreamSkin";
import { FocusModeButton, type GuiFocusMode } from "./codexGui/FocusModeButton";
import { useTerminalPanel } from "./codexGui/terminal/useTerminalPanel";
import { terminalApi } from "./codexGui/terminal/api";
import { MobileConnectionStatus } from "./codexGui/MobileConnectionStatus";
import { AssistanceButton } from '../remoteAssistance/AssistanceButton';
import { GUI_VIEW_TITLES, type GuiView } from "./codexGui/GuiNavigation";
import type { SkillsMarketPageProps } from "./skillsMarket/types";
import paneStyles from "./codexGui/workspacePanes.module.less";
import { useOpenNotifiedThread, type ThreadNavigation } from "./codexGui/useNotificationNavigation";

const GuiPluginsPage = lazy(() => import("./codexGui/GuiPluginsPage"));
const GuiMigrationPage = lazy(() => import("./codexGui/GuiMigrationPage"));
const ScheduledTasksPage = lazy(() => import("./codexGui/scheduledTasks/ScheduledTasksPage")
  .then((module) => ({ default: module.ScheduledTasksPage })));
const TerminalPanel = lazy(() => import("./codexGui/terminal/TerminalPanel"));

type CodexGuiPageProps = {
  active: boolean; accountPicker: ReactNode; providers: Provider[]; aggregateApis: AggregateApi[];
  windowControls?: ReactNode; plugins: Omit<SkillsMarketPageProps, "active">;
  hostPicker?: ReactNode;
  focusMode?: GuiFocusMode;
  notificationTarget?: ThreadNavigation;
};

export function CodexGuiPage(props: CodexGuiPageProps) {
  const { active } = props;
  const focusMode = useGuiLayout(active, !props.focusMode);
  const [visited, setVisited] = useState(active);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  if (!visited) return null;
  if (!hasLocalBackend) return <div className={styles.install}><h2>Codex GUI</h2><p>{guiText("请打开 Remote AI 提供的网页地址，开始对话。")}</p></div>;
  return <Workspace {...props} {...(props.focusMode ?? focusMode)} />;
}

function Workspace({ active, accountPicker, windowControls, plugins, hostPicker, notificationTarget,
  focused, onToggleFocus }: CodexGuiPageProps & GuiFocusMode) {
  const language = useGuiLanguage();
  const diffText = useCallback((source: string, values?: Record<string, string | number>) =>
    guiText(source, values, language), [language]);
  const skinStyle = useDreamSkin(active);
  const [controller] = useState(getGuiController);
  const [view, setView] = useState<GuiView>("conversation");
  const conversationActive = active && view === "conversation";
  useConversationReadState(conversationActive, controller);
  const openTaskConversation = (threadId: string) => {
    setView("conversation");
    controller.filter("", false);
    void controller.select(threadId);
  };
  const composer = useRef<ComposerHandle>(null);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useOpenNotifiedThread({ target: notificationTarget, ready: active && state.connection === "ready", controller,
    showConversation: () => setView("conversation") });
  useEffect(() => {
    controller.capacityRetry.setActive(conversationActive);
    return () => controller.capacityRetry.setActive(false);
  }, [conversationActive, controller]);
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 900);
  const installer = useCliInstaller(active, controller, true);
  useEffect(retainGuiSession, [controller]);
  useTitleSettings(active, controller.titles.settings);
  useEffect(() => {
    if (isDesktopApp || !installer.version) return;
    if (active) void controller.connect();
    else controller.suspend();
  }, [active, controller, installer.version]);
  const current = state.selected ? state.conversations[state.selected] : undefined;
  const thread = current?.thread ?? state.threads.find((entry) => entry.id === state.selected);
  const project = state.selected
    ? state.projectOverrides[state.selected] ?? thread?.cwd ?? "" : state.settings.cwd;
  const terminal = useTerminalPanel(thread?.cwd ?? state.settings.cwd);
  const pending = state.approvals.filter((event) => event.params.threadId === state.selected);
  const navigationApproval = state.approvals.find((event) =>
    view !== "conversation" || event.params.threadId !== state.selected);
  const running = state.sending || Object.values(state.conversations).some((value) => value.activeTurn);
  const canQuote = state.connection === "ready" && !state.sending && !state.archived
    && state.compacting !== state.selected;
  return <DiffTextContext.Provider value={diffText}><WorkspaceOperationContext.Provider value={{ busy: Boolean(state.workspaceBusy),
    setBusy: controller.setWorkspaceBusy }}><DetailsWorkspace selected={state.selected} active={conversationActive}>
    <div className={`${styles.page} ${collapsed ? styles.collapsed : ""}`}
      data-dream-skin={skinStyle ? "true" : undefined} style={skinStyle}>
    {!collapsed && <ThreadSidebar state={state} controller={controller} accountPicker={accountPicker}
      focused={focused} onToggleFocus={onToggleFocus} view={view} onNavigate={setView}
      scheduledTasksAvailable={canManageCodexConnection} />}
    <div className={styles.workspace}>
      <header className={styles.header} data-tauri-drag-region={isDesktopApp || undefined}>
        <Button type="text" icon={collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          aria-label={collapsed ? guiText("展开对话列表") : guiText("收起对话列表")} onClick={() => setCollapsed(!collapsed)} />
        {collapsed && <FocusModeButton focused={focused} onToggleFocus={onToggleFocus} />}
        <div className={styles.heading} data-tauri-drag-region={isDesktopApp || undefined}>
          <strong data-tauri-drag-region={isDesktopApp || undefined}>
            {view === "conversation" && thread ? threadTitle(thread) : GUI_VIEW_TITLES[view]}
          </strong>
        </div>
        <div className={styles.headerActions} data-tauri-drag-region={isDesktopApp || undefined}>
          {isDesktopApp && <AssistanceButton />}
          {isDesktopApp && <MobileConnectionStatus />}
          {installer.version && <Button type="text" icon={<RefreshCw size={16} />} aria-label={guiText("重新连接 Codex")}
            disabled={Boolean(running)} loading={state.connection === "connecting"}
            onClick={() => void controller.connect()} />}
          <Popover trigger="click" placement="bottomRight"
            content={<Installer installer={installer} compact running={Boolean(running)} />}
            styles={{ root: { maxWidth: 400 } }}>
            <Button type="text" icon={<CliUpdateIcon version={installer.version} release={installer.release} />}
              aria-label={guiText("Codex CLI 更新")}>
              {installer.version ? `v${installer.version}` : "Codex"}</Button>
          </Popover>
          {isDesktopApp && view === "conversation" && <Tooltip title={terminal.open ? guiText("收起终端") : guiText("打开终端")}
            styles={{ root: { maxWidth: 400 } }}>
            <Button type="text" icon={<PanelBottom size={16} />} aria-label={terminal.open ? guiText("收起终端") : guiText("打开终端")}
              aria-expanded={terminal.open} onClick={terminal.toggle} />
          </Tooltip>}
          {view === "conversation" && <ConversationChangesButton value={current} />}
        </div>
        {focused && windowControls && <div className={styles.focusWindowControls}>{windowControls}</div>}
      </header>
      {state.error && <Alert className={styles.error} message={state.error}
        type="error" closable onClose={controller.clearError} />}
      <GuiSetupAlerts computerUseSetup={state.computerUseSetup} unattendedSetup={state.unattendedSetup} />
      {navigationApproval && <button className={styles.pendingBanner} onClick={() => {
        openTaskConversation(navigationApproval.params.threadId!);
      }}>{guiText("有对话需要你的确认，点击查看")}</button>}
      {view !== "conversation" && <div className={paneStyles.feature}>
        <Suspense fallback={<div className={paneStyles.loading} role="status">{guiText("正在加载…")}</div>}>
          {view === "scheduled-tasks" && <ScheduledTasksPage active={active} cwd={project}
            onOpenThread={openTaskConversation} />}
          {view === "plugins" && <GuiPluginsPage {...plugins} active={active} />}
          {view === "conversation-migration" && <GuiMigrationPage active={active} notify={plugins.notify} />}
        </Suspense>
      </div>}
      <div className={paneStyles.conversation} hidden={view !== "conversation"}>
      {!installer.version ? <Installer installer={installer} /> :
        <ConversationRetryProvider controller={controller} state={state}>
        <Messages value={current} selected={state.selected} active={conversationActive}
          retry={state.capacityRetry} onCancelRetry={controller.capacityRetry.cancel}
          editCwd={state.selected ? state.projectOverrides[state.selected] : undefined}
          onEdit={controller.messageEditor.submit} editDisabled={!canEditMessage(state)}
          onFork={controller.forkConversation} forkDisabled={!canForkConversation(state)}
          onQuote={canQuote ? (quote) => composer.current?.addQuote(quote) ?? false : undefined}
          pendingRequest={state.pendingRequest} footer={<>
          <Approvals events={pending} controller={controller} />
          <AsyncQuestions value={current} onAnswer={controller.answerAsyncQuestion}
            disabled={state.connection !== "ready" || state.sending || state.archived || Boolean(state.workspaceBusy)
              || Boolean(state.deleting) || state.compacting === state.selected} />
          <Composer ref={composer} state={state} controller={controller} active={conversationActive}
            hostPicker={hostPicker} />
        </>} /></ConversationRetryProvider>}
      {isDesktopApp && terminal.tabs.length > 0 && <Suspense fallback={null}>
        <TerminalPanel panel={terminal} active={conversationActive} api={terminalApi} />
      </Suspense>}
      </div>
    </div>
    </div>
  </DetailsWorkspace></WorkspaceOperationContext.Provider></DiffTextContext.Provider>;
}
