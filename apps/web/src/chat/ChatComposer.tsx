import { t, useLanguage } from '../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, File, MessageSquare, Pause, Play, Plus,
  SlidersHorizontal, Square, Target, X } from 'lucide-react';
import { COMPOSER_ACTION_LABELS } from '../../../../shared/remote-chat/composerAction';
import { composerLabel } from '../../../../shared/remote-chat/composer';
import { requestSpeedSuffix } from '../../../../shared/remote-chat/requestSpeed';
import { formatThreadTokens } from '../../../../shared/remote-chat/usage';
import { useDesktopLayout } from '../useDesktopLayout';
import { ComposerAccess, ComposerDesktopStatus } from './ComposerDesktopControls';
import { ComposerModelPicker } from './ComposerModelPicker';
import { ComposerSpeedIndicator } from './ComposerSpeedIndicator';
import { ChatSettings } from './ChatSettings';
import { ConversationTps } from './ConversationTps';
import { ChatAttachmentPreviews } from './ChatAttachments';
import { pickChatImages } from './pickChatImages';
import { ChatImageEditor } from './ChatImageEditor';
import { ChatUploadProgress } from './ChatUploadProgress';
import { itemUploadProgress } from '../../../../shared/remote-chat/uploadProgress';
import { ChatQueue } from './ChatQueue';
import { ComposerQuotes } from './ChatQuotes';
import { ComposerAddMenu, ComposerPluginMenu, ChatCommandMenu, type ComposerAddAction } from './ComposerMenus';
import { ComposerProjectFiles } from './ComposerProjectFiles';
import { ComposerConversationMenu } from './ComposerConversationMenu';
import { useComposerState } from './useComposerState';
import type { ComposerProps } from './composerProps';
import './composer.css';
import './composerDesktop.css';

export function ChatComposer(props: ComposerProps) {
  useLanguage();
  const desktop = useDesktopLayout();
  const { models, selection, settingsBusy, settingsError, updateSettings, readUsage, tokenUsage, queue,
    uploadProgress, threadId, active, ready, sending, goal, goalBusy, catalog, cwd, loadFiles, loadCatalog } = props;
  const state = useComposerState(props);
  const { draft, attachments, menu, busy, compact, action, actionDisabled, goalMode } = state;
  const [settings, setSettings] = useState(false);
  const [adding, setAdding] = useState(false);
  const [projectFiles, setProjectFiles] = useState<'files' | 'photos' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pickerThread = useRef(threadId);
  const dock = useRef<HTMLDivElement>(null);
  const editing = draft.images.find(image => image.id === editingId);
  const readCatalog = useCallback(() => loadCatalog(cwd), [loadCatalog, cwd]);
  useEffect(() => { if (!active || busy || !editing) setEditingId(null); }, [active, busy, editing]);
  useEffect(() => { if (!active) { setSettings(false); setAdding(false); setProjectFiles(null); } }, [active]);
  useEffect(() => { setSettings(false); setAdding(false); setProjectFiles(null); }, [threadId]);
  useEffect(() => { setProjectFiles(null); }, [cwd]);
  useEffect(() => { if (desktop) setSettings(false); }, [desktop]);
  useEffect(() => {
    if (!adding && !menu.open) return;
    const close = (event: PointerEvent) => {
      if (!dock.current?.contains(event.target as Node)) { setAdding(false); menu.close(); }
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { setAdding(false); menu.close(); }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', keydown);
    };
  }, [adding, menu.open, menu.close]);
  const chooseAdd = (choice: ComposerAddAction) => {
    setAdding(false);
    if (choice === 'plugins') { menu.openPlugins(); return; }
    if (choice === 'projectFiles' || choice === 'projectPhotos') {
      setProjectFiles(choice === 'projectPhotos' ? 'photos' : 'files'); return;
    }
    pickerThread.current = threadId;
    ({ camera: cameraInput, photos: photoInput, file: fileInput })[choice].current?.click();
  };
  const pickPhotos = (files: File[]) => {
    if (pickerThread.current === threadId) void draft.addImages(remaining => pickChatImages(files, remaining));
  };
  const ActionIcon = { send: ArrowUp, pause: desktop ? Square : Pause, continue: Play }[action];
  const label = composerLabel(models, selection, t);
  const closeMenus = () => { menu.close(); setAdding(false); };
  const showSettings = () => { closeMenus(); setSettings(true); };
  const placeholder = desktop ? t('描述任务，@ 引用对话，/ 选择命令和技能…') : t('发消息，@ 引用对话…');
  return <div className="chat-composer-dock" ref={dock} onKeyDown={event => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { setAdding(false); menu.close(); }
  }}>
    {queue && <ChatQueue {...queue} {...state.queueEditor} />}
    <form className={`chat-composer${compact && !desktop ? ' is-compact' : ''}`}
      onSubmit={event => { event.preventDefault(); void state.submit(); }}>
      <input ref={photoInput} type="file" accept="image/*" multiple hidden aria-label={t("选择相册图片")}
        onChange={event => { pickPhotos(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden aria-label={t("拍照")}
        onChange={event => { pickPhotos(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      <input ref={fileInput} type="file" multiple hidden aria-label={t("选择文件")} onChange={event => {
        if (pickerThread.current === threadId) void attachments.pick(Array.from(event.target.files ?? []));
        event.target.value = '';
      }} />
      {state.error && <p role="alert" className="chat-error">{t(state.error)}</p>}
      {desktop && settingsError && <p role="alert" className="chat-error">{t(settingsError)}
        <button type="button" className="chat-button" disabled={settingsBusy}
          onClick={() => { void updateSettings(selection); }}>{t('重新保存')}</button></p>}
      {props.compacting && <p role="status" className="chat-muted">{t("正在压缩上下文…")}</p>}
      {(draft.picking || attachments.busy || state.readingClipboard)
        && <p role="status" className="chat-muted">{t("正在添加附件…")}</p>}
      {(adding || menu.open) && <div className="chat-composer-popover" onKeyDown={event => {
        if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') { setAdding(false); menu.close(); menu.input.current?.focus(); }
      }}>{adding && <ComposerAddMenu busy={busy} choose={chooseAdd} />}
        {!adding && menu.conversations && props.loadConversations && <ComposerConversationMenu
          key={threadId} input={menu.input} query={menu.query} threadId={threadId} ready={ready && !busy}
          load={props.loadConversations} close={menu.close}
          choose={reference => { if (attachments.add(reference)) menu.consumeTrigger(); }} />}
        {!adding && menu.plugins && <ComposerPluginMenu catalog={catalog} query={menu.query} load={readCatalog}
          input={menu.input} close={menu.close}
          chooseSkill={menu.choose}
          choosePlugin={plugin => { attachments.addPlugin(plugin); menu.consumeTrigger(); }} />}
        {!adding && !menu.plugins && !menu.conversations && <ChatCommandMenu
            catalog={catalog} query={menu.query} skillsOnly={menu.skillsOnly} input={menu.input}
            compactReason={props.compactReason} choose={menu.choose} compact={() => { void menu.runCompact(); }}
            goal={() => { menu.consumeTrigger(); goalMode.enter(); }} close={menu.close} />}</div>}
      <div className="chat-composer-field" aria-hidden={settings || undefined}>
        <div className="chat-composer-content">
          <ChatAttachmentPreviews images={draft.images} busy={busy} remove={draft.removeImage}
            upload={sending ? uploadProgress : undefined} reconnecting={!ready}
            add={() => setAdding(true)} edit={id => { menu.input.current?.blur(); setEditingId(id); }} />
          <div className="chat-composer-capsules">{attachments.items.map((item, index) =>
            <span className="chat-capsule" key={`${item.path}:${index}`}>
              {item.kind === 'conversation' ? <MessageSquare size={14} /> : <File size={14} />}
              <span title={item.name}>{item.kind === 'conversation' ? `@${item.name}` : item.name}</span>
              {item.data && <ChatUploadProgress inline reconnecting={!ready}
                progress={itemUploadProgress(sending ? uploadProgress : undefined, 'attachment', index)} />}
              <button type="button" aria-label={t("移除{value1}", { value1: item.name })}
                disabled={busy} onClick={() => attachments.remove(item)}><X size={14} /></button></span>)}</div>
          <ComposerQuotes disabled={busy} />
          <textarea ref={menu.input} aria-label={t("聊天消息")} value={draft.text} maxLength={100_000} rows={1}
            readOnly={state.queueEditor.loading} onPaste={state.paste} onChange={event => {
              draft.setText(event.target.value);
              menu.setSelection({ start: event.target.selectionStart, end: event.target.selectionEnd });
            }}
            onSelect={event => menu.setSelection({ start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd })}
            placeholder={ready ? (goalMode.enabled ? t("描述想完成的目标…") : placeholder) : t("连接后发消息")}
            onKeyDown={event => {
              if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
              state.pasteKeyDown(event);
              if (event.key === 'Escape') { menu.close(); setAdding(false); return; }
              if (event.key !== 'Enter' || event.shiftKey || event.altKey) return;
              if (!desktop && !(event.ctrlKey || event.metaKey)) return;
              if (desktop && action === 'pause') { event.preventDefault(); return; }
              event.preventDefault(); void state.submit();
            }} />
        </div>
        <div className="chat-composer-actions">
          <button type="button" className="chat-composer-add" aria-label={t("添加内容")} aria-expanded={adding}
            disabled={busy} onPointerDown={event => event.preventDefault()}
            onClick={() => { menu.close(); setAdding(value => !value); }}><Plus size={desktop ? 18 : 24} /></button>
          {desktop && <ComposerAccess key={`${threadId}:${active}`} selection={selection}
            settingsBusy={settingsBusy} updateSettings={updateSettings} beforeOpen={closeMenus} />}
          <div className="chat-composer-trailing">
            {(goalMode.enabled || goal) && <span className="chat-goal-capsule"><Target size={15} /><span>{t("目标")}</span>
              <button type="button" aria-label={t("退出目标模式")} disabled={sending || goalBusy || (!!goal && !ready)}
                onClick={state.removeGoal}><X size={13} /></button></span>}
            {desktop && <ComposerDesktopStatus key={`status:${threadId}:${cwd}:${active}`} props={props}
              beforeOpen={closeMenus} />}
            {desktop ? <ComposerModelPicker key={`model:${threadId}:${cwd}:${active}`} models={models}
              selection={selection} updateSettings={updateSettings} settingsBusy={settingsBusy} beforeOpen={closeMenus} />
              : <button type="button" className="chat-model" onPointerDown={event => event.preventDefault()}
              aria-label={t("{value1}{value2}，聊天设置", {
                value1: label, value2: requestSpeedSuffix(selection.speed, t) })}
              onClick={showSettings}>
              {compact && <SlidersHorizontal size={20} />}
              {!compact && <><span>{label}</span><ComposerSpeedIndicator speed={selection.speed} />
                <ChevronDown size={12} /></>}
            </button>}
            <button type="submit" className="chat-composer-submit" aria-label={t(COMPOSER_ACTION_LABELS[action])}
              onPointerDown={event => event.preventDefault()} aria-busy={state.pausing || sending} disabled={actionDisabled}>
              <ActionIcon size={desktop ? 18 : 22}
                fill={action === 'continue' || (desktop && action === 'pause') ? 'currentColor' : 'none'} /></button>
          </div>
        </div>
      </div>
    </form>
    {desktop && <div className="chat-composer-hint"><span>{t('Enter 发送 · Shift + Enter 换行')}</span>
      <span className="chat-conversation-metrics">
        <ConversationTps read={props.readConversationMetrics} threadId={threadId} active={active && ready} />
        <span>{t('当前对话')} {formatThreadTokens(tokenUsage?.total.totalTokens)} Token</span>
      </span>
    </div>}
    {active && !busy && editing && <ChatImageEditor key={editing.id} image={editing}
      save={url => draft.replaceImage(editing, url)} close={() => setEditingId(null)} />}
    {projectFiles && <ComposerProjectFiles imagesOnly={projectFiles === 'photos'} threadId={threadId} cwd={cwd}
      load={loadFiles} close={() => setProjectFiles(null)} choose={file => {
        attachments.add({ kind: 'file', name: file.name, path: file.path }); setProjectFiles(null);
      }} />}
    {!desktop && settings && <ChatSettings models={models} selection={selection} threadId={threadId}
      connection={props.connection}
      contextSettings={props.contextSettings} readUsage={readUsage} tokenUsage={tokenUsage}
      readConversationMetrics={props.readConversationMetrics}
      saving={settingsBusy} error={settingsError} ready={ready}
      updateSettings={updateSettings} onClose={() => setSettings(false)} />}
  </div>;
}
