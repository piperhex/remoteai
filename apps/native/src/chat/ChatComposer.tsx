import { t, useLanguage } from '../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ChatSettings } from './ChatSettings';
import type { ChatConnectionProps } from './ChatProfileMenu';
import { ComposerGoal } from './ComposerGoal';
import { useGoalMode } from '../../../../shared/remote-chat/client/useGoalMode';
import type { RemoteGoals } from '../../../../shared/remote-chat/client/goals';
import type { ThreadGoal } from '../../../desktop/src/pages/codexGui/goalTypes';
import type { ReadUsage } from '../../../../shared/remote-chat/usage';
import type { ReadConversationMetrics } from '../../../../shared/remote-chat/conversationMetrics';
import type { ContextSettingsApi } from '../../../../shared/remote-chat/contextSettings';
import { ComposerActionButton } from './ComposerActionButton';
import { ComposerModelButton } from './ComposerModelButton';
import { ComposerAddMenu, type ComposerAddAction } from './ComposerAddMenu';
import { ComposerPopover } from './ComposerPopover';
import { ComposerPluginMenu } from './ComposerPluginMenu';
import { ComposerConversationMenu } from './ComposerConversationMenu';
import type { ConversationSearch } from '../../../../shared/chat/useConversationCandidates';
import { ComposerReferences } from './ComposerReferences';
import type { UploadProgress } from '../../../../shared/remote-chat/uploadProgress';
import { ComposerQuotes } from './ComposerQuotes';
import { useChatQuotes } from './ChatQuotes';
import { replyWithQuotes } from './replyQuotes';
import { ComposerProjectFiles } from './ComposerProjectFiles';
import { useComposerAttachments } from './useComposerAttachments';
import type { RemoteComposerCatalog } from '../../../../shared/remote-chat/composerCatalog';
import type { ProjectFilesRequest, ProjectFilesResponse } from '../../../../shared/remote-chat/projectFiles';
import { chatAttachmentDataLimit, validateUploadedFiles } from '../../../../shared/remote-chat/composerAttachments';
import { composerAction, CONTINUE_MESSAGE } from '../../../../shared/remote-chat/composerAction';
import { ChatPhotoPicker } from './ChatPhotoPicker';
import { useChatPhotos } from './useChatPhotos';
import { ChatCommandMenu } from './ChatCommandMenu';
import { useComposerMenu } from './useComposerMenu';
import type { SkillCatalogState } from './skillCatalog';
import { useChatDraft } from '../../../../shared/remote-chat/client/useChatDraft';
import type { Model, SendInput, ThreadTokenUsage } from './types';
import { styles } from './styles';
import type { ComposerSettings } from '../../../../shared/remote-chat/composer';
import { ChatQueue } from './ChatQueue';
import type { QueueProps } from '../../../../shared/remote-chat/client/queueProps';
import { useQueueEditor } from '../../../../shared/remote-chat/client/useQueueEditor';

interface Props {
  connection: ChatConnectionProps;
  upload?: UploadProgress;
  reconnecting?: boolean;
  goals?: RemoteGoals;
  goal?: ThreadGoal | null;
  goalBusy?: boolean;
  queue?: QueueProps;
  contextSettings: ContextSettingsApi;
  tokenUsage?: ThreadTokenUsage;
  readUsage: ReadUsage;
  readConversationMetrics: ReadConversationMetrics;
  usageActive: boolean;
  models: Model[];
  selection: ComposerSettings;
  settingsBusy: boolean;
  settingsError: string;
  updateSettings: (settings: Partial<ComposerSettings>) => Promise<void>;
  threadId: string | null;
  active: boolean;
  ready: boolean;
  sending: boolean;
  running: boolean;
  interrupted?: boolean;
  send: (input: SendInput) => Promise<boolean>;
  interrupt: () => Promise<void>;
  catalog: SkillCatalogState & { refresh: () => void };
  cwd: string;
  compactReason: string | null;
  compacting: boolean;
  compact: () => Promise<boolean>;
  loadCatalog: (cwd: string) => Promise<RemoteComposerCatalog>;
  loadFiles: (options: ProjectFilesRequest) => Promise<ProjectFilesResponse>;
  loadConversations: ConversationSearch;
}

export function ChatComposer({ models, selection, settingsBusy, settingsError, updateSettings,
  readUsage, readConversationMetrics, usageActive, tokenUsage, contextSettings, connection, queue, goals, goal, goalBusy,
  threadId, active, ready, sending, running, upload, reconnecting = false, interrupted = false, send, interrupt,
  catalog, cwd, compactReason, compacting, compact, loadCatalog, loadFiles, loadConversations }: Props) {
  useLanguage();
  const [settings, setSettings] = useState(false);
  const goalMode = useGoalMode(threadId, sending);
  useEffect(() => { if (active && ready && threadId) void goals?.load(threadId); }, [goals, threadId, active, ready]);
  const [adding, setAdding] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [projectFiles, setProjectFiles] = useState<'files' | 'photos' | null>(null);
  const [attachmentError, setAttachmentError] = useState('');
  const anchor = useRef<View>(null);
  const [anchorHeight, setAnchorHeight] = useState(0);
  const attachments = useComposerAttachments({ threadId, sending });
  const readCatalog = useCallback(() => loadCatalog(cwd), [loadCatalog, cwd]);
  const photos = useChatPhotos({ threadId, sending });
  const quoteDraft = useChatQuotes();
  const disabled = !ready || settingsBusy || compacting;
  const draft = useChatDraft({ threadId, sending, disabled: disabled || photos.busy || attachments.busy, selection, send });
  const menu = useComposerMenu({ draft, scope: `${threadId ?? ''}:${cwd}`, active,
    refresh: catalog.refresh, compact });
  const quoteCount = quoteDraft?.quotes.length ?? 0;
  const previousQuoteCount = useRef(0);
  useEffect(() => {
    const added = quoteCount > previousQuoteCount.current;
    previousQuoteCount.current = quoteCount;
    if (!added || !active) return;
    const frame = requestAnimationFrame(() => menu.input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [quoteCount, active, menu.input]);
  const hasDraft = draft.hasContent || photos.photos.length > 0 || attachments.items.length > 0
    || Boolean(quoteDraft?.quotes.length);
  const queueEditor = useQueueEditor({ threadId, queue,
    disabled: !active || disabled || sending || photos.busy || attachments.busy || hasDraft,
    restore: (message) => {
      draft.restore({ ...message, images: [], attachments: [] });
      photos.restore(message.images); attachments.restore(message.attachments ?? []);
      menu.setSelection({ start: message.text.length, end: message.text.length });
      requestAnimationFrame(() => menu.input.current?.focus());
    } });
  const compactField = !goalMode.enabled && !goal && !draft.text.length && !hasDraft && !photos.busy && !photos.error;
  useEffect(() => { if (!active) { setSettings(false); setAdding(false); setProjectFiles(null); } }, [active]);
  useEffect(() => { setSettings(false); setAdding(false); setProjectFiles(null); setAttachmentError(''); }, [threadId]);
  useEffect(() => { setProjectFiles(null); }, [cwd]);
  const action = composerAction({ running: running && !hasDraft, interrupted: interrupted && !goalMode.enabled, hasDraft });
  const attachmentBusy = sending || photos.busy || attachments.busy || queueEditor.loading;
  const cannotSend = disabled || attachmentBusy || goalBusy || (goalMode.enabled && running)
    || (action === 'send' && !hasDraft);
  const actionDisabled = action === 'pause' ? !ready || pausing : cannotSend;
  const submit = async () => {
    if (actionDisabled) return;
    if (action === 'pause') {
      setPausing(true);
      try { await interrupt(); } finally { setPausing(false); }
      return;
    }
    const submittedPhotos = photos.photos;
    const submittedAttachments = attachments.items;
    const submittedQuotes = quoteDraft?.quotes ?? [];
    const size = submittedPhotos.reduce((total, photo) => total + photo.dataUrl.length, 0)
      + submittedAttachments.reduce((total, item) => total + (item.data?.length ?? 0), 0);
    try { validateUploadedFiles(submittedAttachments); }
    catch (cause) { setAttachmentError(cause instanceof Error ? cause.message : t("文件无法发送，请重新选择。")); return; }
    if (size > chatAttachmentDataLimit()) { setAttachmentError(t("附件总大小过大，请减少照片或文件后再试。")); return; }
    setAttachmentError('');
    const text = replyWithQuotes(action === 'continue' ? CONTINUE_MESSAGE : draft.text, submittedQuotes);
    const sent = await draft.submit({ text, goalMode: goalMode.enabled,
      images: submittedPhotos.map((photo) => photo.dataUrl), attachments: submittedAttachments });
    if (sent) {
      goalMode.exit();
      photos.clearSubmitted(submittedPhotos); attachments.clearSubmitted(submittedAttachments);
      quoteDraft?.clearSubmitted(submittedQuotes);
    }
  };
  const chooseAdd = (choice: ComposerAddAction) => {
    setAdding(false); setAttachmentError('');
    if (choice === 'plugins') { menu.openPlugins(); return; }
    Keyboard.dismiss();
    if (choice === 'file') { void attachments.pick(); return; }
    if (choice === 'projectFiles' || choice === 'projectPhotos') {
      setProjectFiles(choice === 'projectPhotos' ? 'photos' : 'files'); return;
    }
    void photos.pick(choice);
  };
  const menuContent = () => {
    if (adding) return <ComposerAddMenu busy={attachmentBusy} choose={chooseAdd} />;
    if (menu.conversations) return <ComposerConversationMenu key={threadId} query={menu.query}
      threadId={threadId} ready={ready && !attachmentBusy} load={loadConversations} close={menu.close}
      choose={reference => { if (attachments.add(reference)) menu.consumeTrigger(); }} />;
    if (menu.plugins) return <ComposerPluginMenu catalog={catalog} query={menu.query} load={readCatalog}
      chooseSkill={menu.choose}
      choosePlugin={plugin => { if (attachments.addPlugin(plugin)) menu.consumeTrigger(); }} />;
    return <ChatCommandMenu catalog={catalog} query={menu.query} skillsOnly={menu.skillsOnly}
      compactReason={compactReason} choose={menu.choose}
      goal={goals ? () => { menu.consumeTrigger(); goalMode.enter(); } : undefined}
      compact={() => { void menu.runCompact(); }} close={menu.close} />;
  };
  return <View style={styles.composerDock}>
    {queue && <ChatQueue {...queue} {...queueEditor} />}
    <View style={[styles.composer, compactField && styles.composerCompact]}>
    {!!draft.error && <Text accessibilityRole="alert" style={styles.error}>{draft.error}</Text>}
    {compacting && <Text style={styles.subtitle}>{t("正在压缩上下文…")}</Text>}
    {!!(attachmentError || attachments.error) && <Text accessibilityRole="alert" style={styles.error}>
      {attachmentError || attachments.error}</Text>}
    {attachments.busy && <Text style={styles.status}>{t("正在读取文件…")}</Text>}
    {(adding || menu.open) && <ComposerPopover anchor={anchor} anchorHeight={anchorHeight} wide={!adding}
      close={() => { setAdding(false); menu.close(); }}>
      {menuContent()}
    </ComposerPopover>}
    <View ref={anchor} collapsable={false} style={[styles.composerField, compactField && styles.composerFieldCompact]}
      onLayout={({ nativeEvent }) => setAnchorHeight(nativeEvent.layout.height)}>
      <ScrollView style={styles.composerContent} keyboardShouldPersistTaps="always" nestedScrollEnabled
        contentContainerStyle={styles.composerContentInner}>
      <ChatPhotoPicker photos={photos} disabled={sending} active={active}
        upload={sending ? upload : undefined} reconnecting={reconnecting} />
      <ComposerReferences items={attachments.items} disabled={attachmentBusy} remove={attachments.remove}
        upload={sending ? upload : undefined} reconnecting={reconnecting} />
      <ComposerQuotes disabled={sending} active={active} />
      <TextInput ref={menu.input} accessibilityLabel={t("聊天消息")}
        style={[styles.input, compactField && styles.inputCompact]}
        multiline value={draft.text} maxLength={100_000} selection={menu.selection} editable={!queueEditor.loading}
        placeholderTextColor="#999999" underlineColorAndroid="transparent"
        onSelectionChange={(event) => menu.setSelection(event.nativeEvent.selection)}
        onChangeText={draft.setText}
        placeholder={ready ? (goalMode.enabled ? t("描述想完成的目标…") : t("发消息，@ 引用对话…")) : t("连接后发消息")} />
      </ScrollView>
      <View pointerEvents="box-none" style={[styles.composerActions, compactField && styles.composerActionsCompact]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("添加内容")} style={styles.composerAdd}
          accessibilityState={{ expanded: adding }} onPress={() => { menu.close(); setAdding((current) => !current); }}>
          <Text style={styles.composerAddText}>+</Text>
        </Pressable>
        <View style={styles.composerTrailing}>
          {(goalMode.enabled || goal) && <ComposerGoal disabled={sending || !!goalBusy || (!!goal && !ready)}
            remove={() => {
              if (goal && threadId && goals) void goals.clear(threadId).then((cleared) => { if (cleared) goalMode.exit(); });
              else goalMode.exit();
            }} />}
          <ComposerModelButton models={models} selection={selection} compact={compactField}
            onPress={() => setSettings(true)} />
          <ComposerActionButton action={action} disabled={actionDisabled} busy={pausing || sending}
            onPress={() => { void submit(); }} />
        </View>
      </View>
    </View>
    {projectFiles && <ComposerProjectFiles imagesOnly={projectFiles === 'photos'} threadId={threadId} cwd={cwd}
      load={loadFiles} close={() => setProjectFiles(null)} choose={(file) => {
        if (attachments.add({ kind: 'file', name: file.name, path: file.path })) setProjectFiles(null);
      }} />}
    {settings && <ChatSettings models={models} selection={selection} connection={connection}
      threadId={threadId} contextSettings={contextSettings}
      readUsage={readUsage} usageActive={active && usageActive} tokenUsage={tokenUsage}
      readConversationMetrics={readConversationMetrics}
      saving={settingsBusy} error={settingsError} ready={ready}
      updateSettings={updateSettings} onClose={() => setSettings(false)} />}
  </View></View>;
}
