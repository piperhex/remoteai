import { displayText } from '../i18n/index';
import { displayError } from '../i18n/index';
import { ImageAiContext } from '../../../../shared/chat/ImageAiContext';
import { DesktopUsageContext } from '../../../../shared/chat/DesktopUsageContext';
import { useVisibleChatUsage } from './useVisibleChatUsage';
import { imageAiSender } from '../../../../shared/remote-chat/client/imageAiSender';
import { prepareImageEdit } from './prepareImageEdit';
import { remotePromptSuggestion } from '../../../../shared/remote-chat/client/promptSuggestion';
import { t, useLanguage } from '../i18n';
import { useEffect, useState, type ReactNode } from 'react';
import { PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';
import type { ChatComputer } from '../../../../shared/remote-chat/devices';
import type { ComputerListRefresh } from '../../../../shared/remote-chat/ComputerSearchBar';
import { ChatApproval } from './ChatApproval';
import { ChatComposer } from './ChatComposer';
import { ChatProjectSwitch } from './ChatProjectSwitch';
import type { NativeFileDrop } from './composerProps';
import { queueProps } from '../../../../shared/remote-chat/client/queueProps';
import { ChatMessages, type RenderUserMessage } from './ChatMessages';
import { ChatProcessing } from './ChatProcessing';
import { currentRunningTurn } from '../../../../shared/chat/runningTurn';
import { ChatImageContext } from './ChatImage';
import { ChatFileContext } from './ChatFileLink';
import { ChatAttachmentMetadata } from './ChatAttachmentMetadata';
import { ChatThreads } from './ChatThreads';
import { ChatThreadFilter } from './ChatThreadFilter';
import { ChatListButton } from './ChatListButton';
import { ChatSidebar } from './ChatSidebar';
import { useDesktopLayout, usePanelVisibility } from '../useDesktopLayout';
import { ChatDevices } from './ChatDevices';
import { ChatConnectionInfo } from './ChatConnectionInfo';
import { useRemoteCliInstaller } from '../../../../shared/remote-chat/useRemoteCliInstaller';
import { ChatTaskStatus } from './ChatTaskStatus';
import { visibleChatError } from '../../../../shared/remote-chat/chatError';
import { TaskReviewProvider } from '../../../../shared/remote-chat/TaskReviewContext';
import { ChatRetryProvider } from '../../../../shared/remote-chat/ChatRetryProvider';
import { ChatQuotesProvider } from './ChatQuotes';
import { ChatFileReferencesProvider } from '../../../../shared/chat/ChatFileReferences';
import { ChatDetailsWorkspace } from './ChatDetailsWorkspace';
import { ChatBrowserProvider } from './ChatBrowserProvider';
import { ChatTerminalLayout } from './ChatTerminalLayout';
import { ConversationChangesButton } from '../../../desktop/src/pages/codexGui/ConversationChangesButton';
import { ChatAsyncQuestions } from './ChatAsyncQuestions';
import { ChatSearch } from './ChatSearch';
import { ChatProfileMenu } from './ChatProfileMenu';
import { ChatDesktopAccountPicker } from './ChatDesktopAccountPicker';
import { useChatCatalog } from './useChatCatalog';
import { compactUnavailableReason } from '../../../../shared/remote-chat/client/composerCommands';
import { threadPresentation } from '../../../../shared/remote-chat/sidebar';
import { useChatDrawerSwipe } from './useChatDrawerSwipe';
import type { ChatController, ChatProject, ChatState } from './types';
import './chat.css';

export interface ConnectedChatProps {
  chat: { state: ChatState; controller: ChatController; foreground: boolean };
  device?: ChatComputer; devices: ChatComputer[]; active: boolean;
  scope: string; email: string; chooseDevice: (id: string) => void;
  chooseLocal?: () => void; accountPicker?: ReactNode; headerActions?: ReactNode;
  deviceRefresh?: ComputerListRefresh;
  headerConnectionActions?: ReactNode; headerEnd?: ReactNode;
  draggableHeader?: boolean;
  scrollableComposer?: boolean;
  renderSidebar?: (actions: ChatSidebarActions) => ReactNode;
  renderUserMessage?: RenderUserMessage;
  composerHeader?: ReactNode;
  cliVersion?: string | null;
  conversationFooter?: ReactNode;
  desktopDiffs?: boolean;
  readClipboardImages?: () => Promise<File[]>;
  nativeFileDrop?: NativeFileDrop;
  openAccounts?: () => void;
}

export interface ChatSidebarActions {
  newChat: (project?: ChatProject) => void;
  onClose: () => void;
  openSearch: () => void;
}

/** Conversation UI shared by the web client and the desktop's remote workspace. */
export function ConnectedChat({ chat, device, devices, active, scope, email, chooseDevice,
  chooseLocal, accountPicker, headerActions, headerConnectionActions, headerEnd, renderSidebar, composerHeader,
  conversationFooter, renderUserMessage, draggableHeader, scrollableComposer,
  readClipboardImages, nativeFileDrop, desktopDiffs, deviceRefresh, cliVersion, openAccounts }: ConnectedChatProps) {
  useLanguage();
  const { state, controller, foreground } = chat;
  const [drawer, setDrawer] = useState(false);
  const desktop = useDesktopLayout();
  const [sidebar, setSidebar] = usePanelVisibility('chat-list');
  const [pickingDevice, setPickingDevice] = useState(false);
  const [searching, setSearching] = useState(false);
  const drawerMotion = useChatDrawerSwipe({ enabled: active && !desktop && !pickingDevice && !searching,
    open: drawer, onOpenChange: setDrawer, onNext: openAccounts });
  const listOpen = desktop ? sidebar : drawerMotion.visible;
  const ListToggleIcon = listOpen ? PanelLeftClose : PanelLeftOpen;
  const closeList = () => { if (desktop) setSidebar(false); else drawerMotion.closeDrawer(); };
  const selectedFromList = () => { if (!desktop) drawerMotion.closeDrawer(); };
  const ready = state.ready;
  const usageSnapshot = useVisibleChatUsage(controller.readUsage, desktop && active && foreground && ready);
  const installer = useRemoteCliInstaller(controller.guiTools,
    cliVersion === undefined && desktop && active && foreground && ready);
  const error = visibleChatError(state.error);
  const cwd = state.selected?.cwd ?? state.draftProject?.cwd ?? '';
  const catalog = useChatCatalog(controller, cwd, ready);
  const runningTurn = currentRunningTurn(state.selected?.turns);
  const running = Boolean(runningTurn);
  const approvals = state.approvals.filter((event) => event.params.threadId === state.selected?.id);
  const newChat = (project?: ChatProject) => {
    if (!state.sending) { controller.back(project); drawerMotion.closeDrawer(); }
  };
  useEffect(() => {
    controller.setViewing(active && foreground && (desktop || !drawerMotion.visible) && !pickingDevice && !searching);
  }, [active, foreground, desktop, drawerMotion.visible, pickingDevice, searching, controller]);
  useEffect(() => {
    if (!active) { drawerMotion.closeDrawer(); setPickingDevice(false); setSearching(false); }
  }, [active, drawerMotion.closeDrawer]);
  const showDesktopDiffs = desktopDiffs ?? desktop;
  const composer = <>
    {!!approvals.length && <div className="chat-approvals chat-scroll">
      {approvals.map((event) => <ChatApproval key={String(event.id)} event={event}
        ready={ready} respond={(reply) => controller.respond(reply)} />)}
    </div>}
    <ChatAsyncQuestions thread={state.selected} error={error}
      scope={scope}
      disabled={!ready || state.sending || state.settingsBusy || state.selectedArchived || state.queueBusy
        || state.compacting === state.selected?.id} answer={controller.answerAsyncQuestion} />
    {composerHeader}
    <ChatComposer suggestions={remotePromptSuggestion(state, controller.suggestNextPrompt, { scope })}
      dictation={controller.dictation}
      cliVersion={cliVersion === undefined ? installer.version : cliVersion}
      recoveredEdit={controller.messageEditor.recoveredDrafts.get(state.selected?.id ?? '')}
      consumeRecoveredEdit={() => controller.messageEditor.recoveredDrafts.delete(state.selected?.id ?? '')}
      connectionInfo={<ChatConnectionInfo state={state} controller={controller} device={device} active={active}
        chooseDevice={() => setPickingDevice(true)} />}
      projectPicker={!composerHeader && <ChatProjectSwitch state={state} controller={controller}
        active={active && (desktop ? foreground : true)} />}
      queue={queueProps(state, controller)} readClipboardImages={readClipboardImages} nativeFileDrop={nativeFileDrop}
      connection={{ client: controller.guiAccounts, deviceName: device?.name ?? t("client.settings.chooseAComputer"),
        chooseDevice: () => setPickingDevice(true) }}
      goals={controller.goals} goal={state.selected ? state.goals?.[state.selected.id] : null} goalBusy={!!state.goalBusy}
      contextSettings={controller.contextSettings} cwd={cwd} catalog={catalog}
      compactReason={compactUnavailableReason(state)} compacting={!!state.compacting
        && state.compacting === state.selected?.id} compact={controller.compact}
      loadCatalog={controller.loadComposerCatalog} loadFiles={controller.loadProjectFiles}
      loadConversations={controller.searchThreads}
      uploadProgress={state.upload}
      threadId={state.selected?.id ?? null} models={state.models} selection={state.settings}
      readUsage={controller.readUsage} tokenUsage={state.selected?.tokenUsage}
      readConversationMetrics={controller.readConversationMetrics}
      settingsBusy={state.settingsBusy || !!state.workspaceBusy} settingsError={state.settingsError}
      updateSettings={(settings) => controller.setSettings(settings)}
      refreshModels={controller.refreshModels}
      active={active} ready={ready && !state.selectedArchived} sending={state.sending} running={running}
      interrupted={state.selected?.turns?.at(-1)?.status === 'interrupted'}
      send={(input) => controller.send(input)} interrupt={() => controller.interrupt()} />
  </>;
  const profileMenu = !accountPicker && (desktop ? <ChatDesktopAccountPicker client={controller.guiAccounts}
    ready={ready} active={active && foreground && !searching} device={device} devices={devices}
    deviceRefresh={deviceRefresh} chooseDevice={chooseDevice} chooseLocal={chooseLocal} />
    : <ChatProfileMenu client={controller.guiAccounts}
    deviceName={device?.name ?? t("client.settings.chooseAComputer")} email={email} ready={ready}
    guiTools={controller.guiTools} active={active && foreground && !searching}
    running={state.sending || running || Object.values(state.sidebar.threads).some(thread => thread.running)}
    chooseDevice={() => { drawerMotion.closeDrawer(); setPickingDevice(true); }} />);
  return <DesktopUsageContext.Provider value={usageSnapshot}>
    <ImageAiContext.Provider value={{ enabled: active && ready && !state.selectedArchived
    && !state.sending && !state.settingsBusy && !state.workspaceBusy && !state.compacting,
    send: imageAiSender(controller, prepareImageEdit) }}>
    <ChatImageContext.Provider value={{ threadId: state.selected?.id ?? null, ready,
      load: controller.imagePreview, save: controller.managedPreviews ? controller.savePreviewImage : undefined }}>
    <ChatAttachmentMetadata controller={controller} ready={ready} threadId={state.selected?.id ?? null}>
    <ChatFileContext.Provider value={{ threadId: state.selected?.id ?? null, ready, client: controller.files,
      load: controller.textPreview }}>
    <ChatBrowserProvider controller={controller}>
    <ChatDetailsWorkspace selected={state.selected?.id ?? null} active={active} enabled={showDesktopDiffs}>
    <ChatFileReferencesProvider>
    <ChatQuotesProvider scope={state.selected?.id ?? null} sending={state.sending}
    enabled={active && !state.selectedArchived}>
    <ChatTerminalLayout>
    <header className="chat-header" data-tauri-drag-region={draggableHeader || undefined}>
      {desktop ? <button type="button" className="chat-back"
        aria-label={listOpen ? t("client.chat.collapseChatList") : t("client.chat.openChatList")}
        aria-expanded={listOpen} onClick={() => setSidebar(!sidebar)}>
        <ListToggleIcon size={21} />
      </button> : <ChatListButton client={controller.guiAccounts} active={active && foreground} ready={ready}
        expanded={listOpen} onClick={listOpen ? drawerMotion.closeDrawer : drawerMotion.openDrawer} />}
      <div className="chat-grow" data-tauri-drag-region={draggableHeader || undefined}>
        <h2 data-tauri-drag-region={draggableHeader || undefined}>
          {state.selected ? threadPresentation(state.selected, state.sidebar, displayText).title : t("client.chat.newChat")}</h2>
        {headerConnectionActions}</div>
      {state.selected && state.selectedArchived && <button type="button" className="chat-button"
        disabled={!ready || running}
        onClick={() => { void controller.archive().then(drawerMotion.openDrawer); }}>
        {t("client.chat.restore")}</button>}
      {headerActions}
      {showDesktopDiffs && <ConversationChangesButton
        value={state.selected?.turns ? { turns: state.selected.turns } : undefined} />}
      {headerEnd}
    </header>
    <div className="chat-scroll chat-notices"><div className="chat-notice-content">
      <ChatTaskStatus state={state} />
      {!!error && <p role="alert" className="chat-error">{displayError(error)}</p>}
      {state.desktopOnly && <p className="chat-muted">
        {t("client.remoteDesktop.theDesktopIsReadyOpenRemoteDesktopAndSignIn")}</p>}
    </div></div>
      <TaskReviewProvider controller={controller} state={state} active={active && foreground}>
      <ChatRetryProvider controller={controller} state={state}>
      <ChatMessages thread={state.selected} offline={!ready}
        footer={scrollableComposer ? composer : undefined}
        renderUserMessage={renderUserMessage}
        loading={state.historyLoading} loadingMore={state.historyLoadingMore} hasMore={state.historyHasMore}
        loadOlder={() => controller.loadOlder()} historyLoad={state.historyLoad}
        processing={runningTurn && <ChatProcessing key={runningTurn.id} turn={runningTurn}
          processing={state.processing} active={active && ready} />} />
      </ChatRetryProvider></TaskReviewProvider>
    {!scrollableComposer && composer}
    {conversationFooter}
    </ChatTerminalLayout>
    <ChatSidebar desktop={desktop} open={listOpen} onClose={closeList} customHeading={Boolean(renderSidebar)}
      motion={drawerMotion}
      headingExtra={!renderSidebar && <>
        <ChatThreadFilter state={state} controller={controller} />
        {desktop && <button className="chat-back chat-sidebar-new" type="button"
          aria-label={t("client.chat.newChat")} title={t("client.chat.newChat")}
          disabled={state.sending} onClick={() => newChat()}><Plus size={20} aria-hidden="true" /></button>}
      </>}>
      {renderSidebar ? renderSidebar({ newChat, onClose: selectedFromList, openSearch: () => setSearching(true) })
        : <ChatThreads state={state} controller={controller} newChat={newChat} onClose={selectedFromList}
        openSearch={() => setSearching(true)} accountPicker={accountPicker ?? (desktop ? profileMenu : undefined)}
        profile={!desktop && profileMenu} />}
    </ChatSidebar>
    {searching && <ChatSearch state={state} controller={controller} onClose={() => setSearching(false)}
      select={thread => { setSearching(false); drawerMotion.closeDrawer(); void controller.select(thread); }} />}
    {pickingDevice && <ChatDevices chooseLocal={chooseLocal} devices={devices} onClose={() => setPickingDevice(false)}
      refresh={deviceRefresh} choose={(id) => { chooseDevice(id); setPickingDevice(false); }} />}
  </ChatQuotesProvider></ChatFileReferencesProvider></ChatDetailsWorkspace></ChatBrowserProvider>
  </ChatFileContext.Provider></ChatAttachmentMetadata></ChatImageContext.Provider></ImageAiContext.Provider>
  </DesktopUsageContext.Provider>;
}
