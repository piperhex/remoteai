import { displayError, displayText } from '../i18n/index';
import { flushSync } from 'react-dom';
import { ComposerDictation } from '../../../../shared/chat/dictation/ComposerDictation';
import { useComposerSuggestion } from '../../../../shared/chat/useComposerSuggestion';
import { ComposerSuggestion } from './ComposerSuggestion';
import { ComposerInput } from './ComposerInput';
import { t, useLanguage } from '../i18n';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, Pause, Play, Plus,
  SlidersHorizontal, Square, X } from 'lucide-react';
import { COMPOSER_ACTION_LABELS } from '../../../../shared/remote-chat/composerAction';
import { composerLabel } from '../../../../shared/remote-chat/composer';
import { requestSpeedSuffix } from '../../../../shared/remote-chat/requestSpeed';
import { useDesktopLayout } from '../useDesktopLayout';
import { ComposerAccess, ComposerDesktopStatus } from './ComposerDesktopControls';
import { ComposerModelPicker } from './ComposerModelPicker';
import { ComposerSpeedIndicator } from './ComposerSpeedIndicator';
import { ChatSettings } from './ChatSettings';
import { ModelRefreshButton } from './ModelRefreshButton';
import { ComposerFooter } from './ComposerFooter';
import { DesktopUsageContext } from '../../../../shared/chat/DesktopUsageContext';
import { useConversationMetrics } from '../../../../shared/remote-chat/client/useConversationMetrics';
import { ComposerGoal } from './ComposerGoal';
import { ChatAttachmentPreviews } from './ChatAttachments';
import { pickChatImages } from './pickChatImages';
import { ChatImageEditor } from './ChatImageEditor';
import { ComposerAttachments } from './ComposerAttachments';
import { ChatQueue } from './ChatQueue';
import { ComposerQuotes } from './ChatQuotes';
import { ComposerAddMenu, ComposerPluginMenu, ChatCommandMenu, type ComposerAddAction } from './ComposerMenus';
import { ComposerProjectFiles } from './ComposerProjectFiles';
import { ComposerConversationMenu } from './ComposerConversationMenu';
import { ComposerFileMenu } from './ComposerFileMenu';
import { useComposerState } from './useComposerState';
import type { ComposerProps } from './composerProps';
import './composer.css';
import './composerDesktop.css';

export function ChatComposer(props: ComposerProps) {
  useLanguage();
  const desktop = useDesktopLayout();
  const usageSnapshot = useContext(DesktopUsageContext);
  const metrics = useConversationMetrics(props.readConversationMetrics, props.threadId,
    desktop && props.active && props.ready && usageSnapshot.visible);
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
  const suggestion = useComposerSuggestion({ source: props.suggestions, value: draft.text,
    blocked: !active || !ready || sending || props.running || props.compacting || settingsBusy || busy || state.dictationBusy
      || draft.hasContent || attachments.items.length > 0 || state.hasQuotes || state.readingClipboard
      || state.queueEditor.loading || menu.open || adding || settings || !!projectFiles || goalMode.enabled,
    fill: text => { draft.setText(text); menu.setSelection({ start: text.length, end: text.length });
      menu.input.current?.focus(); } });
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
  const label = composerLabel(models, selection, displayText);
  const closeMenus = () => { menu.close(); setAdding(false); };
  const showSettings = () => { closeMenus(); setSettings(true); };
  const placeholder = desktop ? t("client.fileReferences.describeATaskFilesConversationsCommandsAndSkills")
    : t("client.fileReferences.filesConversations");
  return <div className="chat-composer-dock" ref={dock} onKeyDown={event => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { setAdding(false); menu.close(); }
  }}>
    {props.projectPicker}
    {queue && <ChatQueue {...queue} {...state.queueEditor} editDisabled={state.queueEditor.editDisabled || busy} />}
    <form className={`chat-composer${props.dictation ? ' has-dictation' : ''}`
      + `${compact && !desktop && !suggestion.text ? ' is-compact' : ''}`}
      onSubmit={event => { event.preventDefault(); void state.submit(); }}>
      <input ref={photoInput} type="file" accept="image/*" multiple hidden aria-label={t("client.chat.choosePhotos")}
        onChange={event => { pickPhotos(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden aria-label={t("client.chat.takePhoto")}
        onChange={event => { pickPhotos(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      <input ref={fileInput} type="file" multiple hidden aria-label={t("client.cliImport.chooseFile")} onChange={event => {
        if (pickerThread.current === threadId) void attachments.pick(Array.from(event.target.files ?? []));
        event.target.value = '';
      }} />
      {state.error && <p role="alert" className="chat-error">{displayError(state.error)}</p>}
      {desktop && settingsError && <p role="alert" className="chat-error">{displayError(settingsError)}
        <ModelRefreshButton ready={ready} refreshModels={props.refreshModels} />
        <button type="button" className="chat-button" disabled={!ready || !models.length}
          onClick={() => { void updateSettings(selection); }}>{t("client.chat.saveAgain")}</button></p>}
      {props.compacting && <p role="status" className="chat-muted">{t("client.chat.compactingContext")}</p>}
      {(draft.picking || attachments.busy || state.readingClipboard || state.drop.reading)
        && <p role="status" className="chat-muted">{t("client.chat.addingAttachments")}</p>}
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
        {!adding && menu.files && <ComposerFileMenu key={`${threadId}:${cwd}`} input={menu.input}
          query={menu.query} threadId={threadId} cwd={cwd} ready={ready && !busy} load={loadFiles} close={menu.close}
          choose={reference => { if (attachments.add(reference)) menu.consumeTrigger(); }} />}
        {!adding && !menu.plugins && !menu.conversations && !menu.files && <ChatCommandMenu
            catalog={catalog} query={menu.query} skillsOnly={menu.skillsOnly} input={menu.input}
            compactReason={props.compactReason} choose={menu.choose} compact={() => { void menu.runCompact(); }}
            goal={() => { menu.consumeTrigger(); goalMode.enter(); }} close={menu.close} />}</div>}
      <div className="chat-composer-field" aria-hidden={settings || undefined}
        ref={state.dropTarget} {...state.drop.handlers} data-file-dragging={state.drop.dragging || undefined}>
        <div className="chat-composer-content">
          <ChatAttachmentPreviews images={draft.images} busy={busy} remove={draft.removeImage}
            upload={sending ? uploadProgress : undefined} reconnecting={!ready}
            add={() => setAdding(true)} edit={id => { menu.input.current?.blur(); setEditingId(id); }} />
          <ComposerAttachments items={attachments.items} busy={busy} active={active} ready={ready}
            uploadProgress={sending ? uploadProgress : undefined} remove={attachments.remove} />
          <ComposerQuotes disabled={busy} />
          {(goalMode.enabled || goal) && <ComposerGoal key={`goal:${threadId}:${active}`}
            goal={goalMode.enabled ? null : goal} draft={draft.text}
            disabled={sending || goalBusy || (!!goal && !ready)} remove={state.removeGoal}
            beforeOpen={() => { closeMenus(); menu.input.current?.blur(); }} />}
          <ComposerSuggestion text={suggestion.text} accept={suggestion.accept} />
          <ComposerInput ref={menu.input} aria-label={t("client.chat.chatMessage")} value={draft.text} maxLength={100_000} rows={1}
            contextScope={`${threadId}:${cwd}`} active={active}
            readOnly={state.queueEditor.loading}
            onBeforeInput={suggestion.dismiss} onCompositionStart={suggestion.dismiss}
            onCompositionEnd={suggestion.restore}
            onPaste={event => { suggestion.dismiss(); state.paste(event); }} onChange={event => {
              if (event.target.value) suggestion.dismiss();
              else suggestion.restore();
              draft.setText(event.target.value);
              menu.setSelection({ start: event.target.selectionStart, end: event.target.selectionEnd });
            }}
            onSelect={event => menu.setSelection({ start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd })}
            placeholder={ready ? (goalMode.enabled ? t("client.chat.describeYourGoal") : placeholder) : t("client.chat.connectToSendAMessage")}
            onKeyDown={event => {
              if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
                && !menu.open && suggestion.accept()) { event.preventDefault(); return; }
              if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) suggestion.dismiss();
              state.pasteKeyDown(event);
              if (event.key === 'Escape') { menu.close(); setAdding(false); return; }
              if (event.key !== 'Enter' || event.shiftKey || event.altKey) return;
              if (!desktop && !(event.ctrlKey || event.metaKey)) return;
              if (desktop && action === 'pause') { event.preventDefault(); return; }
              event.preventDefault(); void state.submit();
            }} />
        </div>
        <div className="chat-composer-actions">
          <button type="button" className="chat-composer-add" aria-label={t("client.chat.addContent")} aria-expanded={adding}
            disabled={busy} onPointerDown={event => event.preventDefault()}
            onClick={() => { menu.close(); setAdding(value => !value); }}><Plus size={desktop ? 18 : 24} /></button>
          {desktop && <ComposerAccess key={`${threadId}:${active}`} selection={selection}
            settingsBusy={settingsBusy} updateSettings={updateSettings} beforeOpen={closeMenus} />}
          <div className="chat-composer-trailing">
            {desktop && <ComposerDesktopStatus key={`status:${threadId}:${cwd}:${active}`} props={props}
              beforeOpen={closeMenus} metrics={metrics} />}
            {desktop ? <ComposerModelPicker key={`model:${threadId}:${cwd}:${active}`} models={models}
              ready={ready} refreshModels={props.refreshModels}
              selection={selection} updateSettings={updateSettings} settingsBusy={settingsBusy} beforeOpen={closeMenus} />
              : <button type="button" className="chat-model" onPointerDown={event => event.preventDefault()}
              aria-label={t("client.chat.chatSettings", {
                value1: label, value2: requestSpeedSuffix(selection.speed, displayText) })}
              onClick={showSettings}>
              {compact && <SlidersHorizontal size={20} />}
              {!compact && <><span>{label}</span><ComposerSpeedIndicator speed={selection.speed} />
                <ChevronDown size={12} /></>}
            </button>}
            {props.dictation && <ComposerDictation key={`dictation:${threadId}:${cwd}`} client={props.dictation}
              active={active && ready && !sending && !props.compacting && !settings && !settingsBusy && !goalBusy}
              disabled={!active || !ready || busy || settingsBusy || props.compacting || goalBusy}
              onBusyChange={state.setDictationBusy}
              onText={text => { flushSync(() => draft.appendDictation(text)); menu.input.current?.focus(); }} />}
            <button type="submit" className="chat-composer-submit" aria-label={displayText(COMPOSER_ACTION_LABELS[action])}
              onPointerDown={event => event.preventDefault()} aria-busy={state.pausing || sending} disabled={actionDisabled}>
              <ActionIcon size={desktop ? 18 : 22}
                fill={action === 'continue' || (desktop && action === 'pause') ? 'currentColor' : 'none'} /></button>
          </div>
        </div>
      </div>
    </form>
    <ComposerFooter desktop={desktop} cliVersion={props.cliVersion}
      usage={usageSnapshot.usage} metrics={metrics}
      connectionInfo={props.connectionInfo} />
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
      saving={settingsBusy} error={settingsError} ready={ready} refreshModels={props.refreshModels}
      updateSettings={updateSettings} onClose={() => setSettings(false)} />}
  </div>;
}
