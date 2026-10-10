import { t, useLanguage } from '../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AuthSession, RemoteDevice } from '../types';
import { ChatApproval } from './ChatApprovals';
import { ChatAsyncQuestions } from './ChatAsyncQuestions';
import { ChatComposer } from './ChatComposer';
import { ChatOverlay } from './ChatOverlay';
import { queueProps } from '../../../../shared/remote-chat/client/queueProps';
import { ChatMessages } from './ChatMessages';
import { ChatQuotesProvider } from './ChatQuotes';
import { ChatProcessing } from './ChatProcessing';
import { ChatImageContext } from './ChatImage';
import { ChatImagePreviewProvider } from './ChatImagePreview';
import { ChatFileProvider } from './ChatFilePreview';
import { ChatThreads } from './ChatThreads';
import { ChatProfileMenu } from './ChatProfileMenu';
import { TokenSummaryPage } from '../tokenSummary/TokenSummaryPage';
import { ChatSearch } from './ChatSearch';
import { ChatDrawer, type ChatDrawerMethods } from './ChatDrawer';
import { ChatDevices } from './ChatDevices';
import { ChatConnectionInfo } from './ChatConnectionInfo';
import { ChatTaskStatus } from './ChatTaskStatus';
import { visibleChatError } from '../../../../shared/remote-chat/chatError';
import { TaskReviewProvider } from '../../../../shared/remote-chat/TaskReviewContext';
import { ChatRetryProvider } from '../../../../shared/remote-chat/ChatRetryProvider';
import { ChatTools } from './ChatTools';
import { useChat } from './useChat';
import { useDownloadConnection } from '../downloads/useDownloadConnection';
import { useChatDevice } from './useChatDevice';
import { useOfflineDevices } from './offline/devices';
import { useChatDrawerSwipe } from './useChatDrawerSwipe';
import { useChatBackground } from './useChatBackground';
import { useChatCompletionNotifications, useOpenChatNotification } from './useChatNotifications';
import { notificationId, type ChatNotificationTarget } from './notificationTarget';
import { useStyles } from './styles';
import { threadPresentation } from '../../../../shared/remote-chat/sidebar';
import type { ChatProject } from './types';
import { compactUnavailableReason } from '../../../../shared/remote-chat/client/composerCommands';

interface Props {
  session: AuthSession; devices: RemoteDevice[]; devicesLoaded: boolean; active: boolean;
  notification: ChatNotificationTarget | null; notificationError: string;
  notificationHandled: (id: string) => void;
  tokenSummary: boolean; openTokenSummary: () => void; closeTokenSummary: () => void;
}

export function ChatPage(props: Props) {
  const styles = useStyles();
  useLanguage();
  const { session, active, notification, notificationError, notificationHandled } = props;
  const devices = useOfflineDevices(session, props.devices, props.devicesLoaded);
  const { device, chooseDevice: selectDevice } = useChatDevice({ session, devices,
    devicesLoaded: props.devicesLoaded, requestedDeviceId: notification?.deviceId });
  const backgroundError = useChatBackground(Boolean(device));
  const chooseDevice = (id: string) => {
    if (notification) notificationHandled(notificationId(notification));
    selectDevice(id);
  };
  return <View style={[styles.page, !active && styles.hidden]}>
    {notification && devices.length > 0 && !device && <Text style={styles.error}>
      {t("通知对应的电脑暂不可用，请选择其他电脑。")}</Text>}
    {!!backgroundError && <Text accessibilityRole="alert" style={styles.error}>{backgroundError}</Text>}
    {!!notificationError && <Pressable accessibilityRole="button" accessibilityLabel={t("打开通知设置")}
      onPress={() => { void Linking.openSettings(); }}><Text style={styles.error}>{notificationError}</Text></Pressable>}
    <ConnectedChat key={`${session.baseUrl}:${session.email}:${device?.deviceId ?? ''}`} {...props} session={session}
      device={device} devices={devices} active={active} chooseDevice={chooseDevice}
      notification={notification} notificationError={notificationError} notificationHandled={notificationHandled} />
  </View>;
}

function ConnectedChat({ session, device, devices, active: pageActive, chooseDevice, notification, notificationHandled,
  tokenSummary, openTokenSummary, closeTokenSummary }: Props & {
  device?: RemoteDevice; chooseDevice: (id: string) => void;
}) {
  const styles = useStyles();
  useLanguage();
  const active = pageActive && !tokenSummary;
  const insets = useSafeAreaInsets();
  const { state, controller, foreground, catalog } = useChat(session, device?.deviceId ?? '', Boolean(device));
  useDownloadConnection({ session, deviceId: device?.deviceId ?? '', deviceName: device?.name ?? '', controller });
  useChatCompletionNotifications(controller, session, device?.deviceId ?? '');
  useOpenChatNotification({ controller, target: notification?.deviceId === device?.deviceId ? notification : null,
    ready: state.ready, sending: state.sending, handled: notificationHandled });
  const [drawer, setDrawer] = useState(false);
  const drawerRef = useRef<ChatDrawerMethods>(null);
  const afterClose = useRef<(() => void) | undefined>(undefined);
  const [pickingDevice, setPickingDevice] = useState(false);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (!notification) return;
    afterClose.current = undefined;
    drawerRef.current?.closeDrawer(); setPickingDevice(false); setSearching(false);
  }, [notification]);
  const ready = state.ready;
  const error = visibleChatError(state.error);
  const runningTurn = ready ? state.selected?.turns?.find((turn) => turn.status === 'inProgress') : undefined;
  const running = Boolean(runningTurn);
  const openDrawer = useCallback(() => { Keyboard.dismiss(); setDrawer(true); drawerRef.current?.openDrawer(); }, []);
  const drawerSwipeHandlers = useChatDrawerSwipe(active && !drawer && !pickingDevice, openDrawer);
  const closeDrawer = (action?: () => void) => { afterClose.current = action; drawerRef.current?.closeDrawer(); };
  const closed = useCallback(() => {
    setDrawer(false);
    const action = afterClose.current;
    afterClose.current = undefined;
    action?.();
  }, []);
  const newChat = (project?: ChatProject) => { if (!state.sending) closeDrawer(() => controller.back(project)); };
  useEffect(() => { controller.setViewing(active && foreground && !drawer && !pickingDevice && !searching); },
    [active, foreground, drawer, pickingDevice, searching, controller]);
  useEffect(() => {
    if (active) return;
    afterClose.current = undefined;
    drawerRef.current?.closeDrawer(); setPickingDevice(false); setSearching(false);
  }, [active]);
  useEffect(() => {
    if (!active || pickingDevice || (!drawer && !state.selected)) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (drawer) closeDrawer();
      else if (!state.sending) controller.back();
      return true;
    });
    return () => subscription.remove();
  }, [active, drawer, pickingDevice, state.selected?.id, state.sending, controller]);
  return <>
  {tokenSummary && pageActive && <TokenSummaryPage read={controller.readTokenSummary} ready={ready}
    foreground={foreground} deviceName={device?.name} onBack={closeTokenSummary} />}
  <View style={[styles.fill, tokenSummary && styles.hidden]}>
  <ChatQuotesProvider active={active} scope={state.selected?.id ?? null}
    enabled={active && !state.selectedArchived}>
  <ChatDrawer ref={drawerRef} enabled={active && !pickingDevice}
    onOpen={() => setDrawer(true)} onMoving={() => setDrawer(true)} onClose={closed}
    navigation={<ChatThreads state={state} controller={controller} newChat={newChat}
      openSearch={() => setSearching(true)}
      profileMenu={<ChatProfileMenu client={controller.guiAccounts} deviceName={device?.name} email={session.email}
        guiTools={controller.guiTools}
        running={state.sending || running || Object.values(state.sidebar.threads).some(thread => thread.running)}
        chooseDevice={() => closeDrawer(() => setPickingDevice(true))}
        openTokenSummary={() => closeDrawer(openTokenSummary)}
        ready={ready} active={active && foreground && drawer && !searching} />}
      select={(thread) => closeDrawer(() => { void controller.select(thread); })} />}>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      // The drawer resets local Y to zero; iOS keyboard coordinates still include the top safe area.
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      {...drawerSwipeHandlers}>
    <ChatOverlay>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("打开聊天列表")} style={styles.back}
        onPress={openDrawer}><Text style={styles.backText}>☰</Text></Pressable>
      <View style={styles.headerContent}>
        <Text numberOfLines={1} style={styles.headerTitle}>
          {state.selected ? threadPresentation(state.selected, state.sidebar, t).title : t("新聊天")}</Text>
        <ChatConnectionInfo state={state} controller={controller} device={device} active={active && foreground} />
      </View>
      {state.selected && state.selectedArchived && <Pressable accessibilityRole="button"
        style={styles.compactButton} disabled={!ready || running}
        onPress={() => { void controller.archive().then(openDrawer); }}>
        <Text style={styles.buttonText}>{t("恢复")}</Text></Pressable>}
      <View style={styles.headerTools}>
        <ChatTools client={controller.guiTools} active={active && foreground} connected={ready}
          deviceName={device?.name} cwd={state.selected?.cwd ?? state.draftProject?.cwd ?? ''} />
      </View>
    </View>
    <ChatTaskStatus state={state} />
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {state.desktopOnly && <Text style={[styles.subtitle, { maxWidth: 400, paddingHorizontal: 16 }]}>
      {t("桌面已就绪。打开远程桌面，登录电脑后即可继续聊天。")}</Text>}
    <ChatImageContext.Provider value={{ threadId: state.selected?.id ?? null, ready, offline: true,
      load: controller.imagePreview, save: controller.managedPreviews ? controller.savePreviewImage : undefined }}>
      <ChatImagePreviewProvider key={state.selected?.id ?? 'new'}>
      <ChatFileProvider key={state.selected?.id ?? 'new'} threadId={state.selected?.id ?? null}
        ready={ready} load={controller.textPreview} videos={controller.videos} files={controller.files}>
      <TaskReviewProvider controller={controller} state={state} active={active && foreground}>
      <ChatRetryProvider controller={controller} state={state}>
      <ChatMessages key={state.selected?.id ?? 'new'} thread={state.selected} offline={!ready}
        loading={state.historyLoading} loadingMore={state.historyLoadingMore} hasMore={state.historyHasMore}
        loadOlder={() => controller.loadOlder()}
        processing={runningTurn && <ChatProcessing key={runningTurn.id} turn={runningTurn}
          processing={state.processing} active={active && ready && foreground} />} />
      </ChatRetryProvider></TaskReviewProvider>
      </ChatFileProvider>
      </ChatImagePreviewProvider>
    </ChatImageContext.Provider>
    {ready && state.approvals.some((event) => event.params.threadId === state.selected?.id) &&
      <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={styles.padded} keyboardShouldPersistTaps="handled">
        {state.approvals.filter((event) => event.params.threadId === state.selected?.id).map((event) =>
          <ChatApproval key={String(event.id)} event={event} respond={(reply) => controller.respond(reply)} />)}
      </ScrollView>}
    <ChatAsyncQuestions thread={state.selected} error={error}
      disabled={!ready || state.sending || state.settingsBusy || state.selectedArchived || state.queueBusy
        || state.compacting === state.selected?.id}
      answer={controller.answerAsyncQuestion} />
    <ChatComposer queue={queueProps(state, controller)}
      connection={{ client: controller.guiAccounts, deviceName: device?.name,
        chooseDevice: () => setPickingDevice(true) }}
      goals={controller.goals} goal={state.selected ? state.goals?.[state.selected.id] : null} goalBusy={state.goalBusy}
      threadId={state.selected?.id ?? null} models={state.models} selection={state.settings}
      contextSettings={controller.contextSettings}
      readUsage={controller.readUsage} usageActive={foreground && ready} tokenUsage={state.selected?.tokenUsage}
      readConversationMetrics={controller.readConversationMetrics}
      loadCatalog={controller.loadComposerCatalog} loadFiles={controller.loadProjectFiles}
      loadConversations={controller.searchThreads}
      catalog={catalog} cwd={state.selected?.cwd ?? state.draftProject?.cwd ?? ''}
      compactReason={compactUnavailableReason(state)} compacting={!!state.compacting
        && state.compacting === state.selected?.id} compact={controller.compact}
      settingsBusy={state.settingsBusy} settingsError={state.settingsError}
      updateSettings={(settings) => controller.setSettings(settings)}
      active={active} ready={ready} sending={state.sending} running={running}
      upload={state.upload} reconnecting={state.mode === 'connecting' || state.mode === 'offline'}
      send={(input) => controller.send(input)} interrupted={state.selected?.turns?.at(-1)?.status === 'interrupted'}
      interrupt={() => controller.interrupt()} />
    {pickingDevice && <ChatDevices devices={devices} onClose={() => setPickingDevice(false)}
      choose={(id) => { chooseDevice(id); setPickingDevice(false); }} />}
    {searching && active && <ChatSearch state={state} controller={controller} onClose={() => setSearching(false)}
      select={(thread) => { setSearching(false); closeDrawer(() => { void controller.select(thread); }); }} />}
    </ChatOverlay>
  </KeyboardAvoidingView></ChatDrawer></ChatQuotesProvider></View></>;
}
