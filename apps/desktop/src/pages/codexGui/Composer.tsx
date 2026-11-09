import { displayText } from '../../../../../shared/localization/uiText';
import { CodexVersionStatus } from '../../../../../shared/codex-status/CodexVersionStatus';
import { readCodexServiceStatus } from '../../api/codexServiceStatus';
import { uiText } from "../../../../../shared/localization/uiText";
import {
  forwardRef, useContext, useEffect, useImperativeHandle, useRef, useState, type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { Target, X } from "lucide-react";
import { isDesktopApp } from "../../api/backend";
import { desktopSshProfiles } from '../../api/sshProfiles';
import { useGoalMode } from "../../../../../shared/remote-chat/client/useGoalMode";
import { ComposerAddMenu } from "./ComposerAddMenu";
import { ComposerFilesDialog } from "./ComposerFilesDialog";
import { ComposerReferences } from "./ComposerReferences";
import { ComposerQuotes } from "./ComposerQuotes";
import type { ReplyQuote } from "../../../../../shared/conversation/replyQuotes";
import { GoalDialog } from "./GoalDialog";
import { GOAL_STATUS } from "../../../../../shared/conversation/goalTypes";
import extras from "./ComposerExtras.module.less";
import { AccessPicker } from "./AccessPicker";
import { ComposerSubmit } from "./ComposerSubmit";
import { ComposerDictation } from "./ComposerDictation";
import type { GuiController } from "./controller";
import type { AccessMode, GuiState } from "../../../../../shared/conversation/types";
import { ImageAttachments } from "./ImageAttachments";
import { useComposerDrop } from './useComposerDrop';
import { IMAGE_TYPES, useComposerDraft } from "./useComposerDraft";
import { ModelPicker } from "./ModelPicker";
import { modelSelectionError } from "../../../../../shared/conversation/modelSelection";
import { useGuiRequestSpeed } from "./useGuiRequestSpeed";
import { UsageStatus } from "./UsageStatus";
import { DesktopUsageContext } from '../../../../../shared/chat/DesktopUsageContext';
import { useConversationMetrics } from '../../../../../shared/remote-chat/client/useConversationMetrics';
import { loadConversationMetrics } from '../../api/conversationMetrics';
import { ConversationTokenStatus } from './ConversationTokenStatus';
import { ProjectPicker } from "./ProjectPicker";
import { GuiToolbox } from "../../../../../shared/conversation/GuiToolbox";
import { useLocalGitDownloads } from '../../downloads/localGitDownloads';
import { LocalProjectBrowser } from './LocalProjectBrowser';
import { useComposerFileReferences } from '../../../../../shared/chat/ChatFileReferences';
import { useComposerImageAnnotations } from '../../../../../shared/chat/ImageAnnotations';
import { localGitClient } from "./localGitClient";
import { SkillInput, type SkillInputHandle } from "./SkillInput";
import { useNextPromptSuggestion } from './useNextPromptSuggestion';
import { compactCommand } from "./composerOptions";
import { QueuedMessages } from "./QueuedMessages";
import { RunningChangesSummary } from "./RunningChangesSummary";
import styles from "../../../../../shared/conversation/styles.module.less";

export interface ComposerHandle { addQuote: (quote: ReplyQuote) => boolean }

export const Composer = forwardRef<ComposerHandle, {
  state: GuiState; controller: GuiController; active: boolean; hostPicker?: ReactNode;
  cliVersion?: string | null;
}>(function Composer({ state, controller, active, hostPicker, cliVersion }, ref) {
  useLocalGitDownloads();
  const fileInput = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const dropTarget = useRef<HTMLDivElement>(null);
  const skillInput = useRef<SkillInputHandle>(null);
  const key = state.selected ?? "new";
  const [dialog, setDialog] = useState<"files" | "goal" | null>(null);
  const [dictating, setDictating] = useState(false);
  const goalMode = useGoalMode(state.selected, Boolean(state.goalBusy));
  const requestSpeed = useGuiRequestSpeed(active);
  const usageSnapshot = useContext(DesktopUsageContext);
  const metrics = useConversationMetrics(loadConversationMetrics, state.selected, active && state.connection === 'ready');
  const workspaceBusy = Boolean(state.workspaceBusy);
  const { draft, reading: draftReading, editContent, appendDictation, removeImage, editImage, addImages,
    paste, pasteKeyDown, send: sendDraft, addAttachments, removeAttachment, addQuote, removeQuote,
    clearQuotes, editQueued, addAnnotatedImage }
    = useComposerDraft(key, controller);
  // Creating a goal first creates its conversation; keep the form until the goal request succeeds.
  useEffect(() => { if (!controller.getSnapshot().goalBusy || !active) setDialog(null); }, [key, active, controller]);
  const current = state.selected ? state.conversations[state.selected] : undefined;
  const thread = current?.thread ?? state.threads.find((entry) => entry.id === state.selected);
  const project = state.selected
    ? state.projectOverrides[state.selected] ?? thread?.cwd ?? "" : state.settings.cwd;
  const running = Boolean(current?.activeTurn);
  const queuedMessages = state.selected ? state.queued[state.selected] ?? [] : [];
  const disabled = workspaceBusy || state.connection !== "ready" || state.sending || state.archived
    || state.compacting === state.selected;
  const drop = useComposerDrop({ target: dropTarget, selected: state.selected, active,
    disabled: disabled || draftReading || !!dialog, addAttachments, addImages,
    setProject: controller.setProject, report: controller.report, focus: () => skillInput.current?.focus() });
  const reading = draftReading || drop.reading || dictating;
  useComposerImageAnnotations({ scope: `${key}:${project}`, mode: 'direct',
    enabled: active && !disabled && !reading && !goalMode.enabled,
    add: addAnnotatedImage, focus: () => skillInput.current?.focus() });
  useComposerFileReferences({ scope: `${key}:${project}`,
    enabled: active && !disabled && !reading && !goalMode.enabled,
    add: reference => addAttachments([reference]), addQuote, focus: () => skillInput.current?.focus() });
  const hasDraft = Boolean(draft.text.trim() || draft.images.length
    || draft.attachments?.length || draft.quotes?.length);
  const suggestion = useNextPromptSuggestion(state, { active,
    blocked: Boolean(draft.text || hasDraft || reading || goalMode.enabled || dialog) });
  useImperativeHandle(ref, () => ({ addQuote: (quote) => {
    if (disabled || !active || !current?.turns.some((turn) => turn.items.some((item) =>
      item.id === quote.messageId && item.type === "agentMessage"))) return false;
    if (!addQuote(quote)) return false;
    skillInput.current?.focus();
    return true;
  } }));
  const goal = state.selected ? state.goals?.[state.selected] : null;
  const canSend = !disabled && !reading && !state.modelSettingsLoading && !state.modelCatalogLoading
    && !modelSelectionError(state.models, state.settings) && hasDraft;
  const send = async () => {
    if (!canSend || drop.isReading()) return;
    await sendDraft(goalMode.enabled, goalMode.exit);
  };
  const editQueuedMessage = (id: string) => {
    if (disabled || reading || !active) return;
    let restored = false;
    flushSync(() => { restored = editQueued(id); });
    if (restored) skillInput.current?.focus();
  };
  return <div ref={dropTarget} className={styles.composerWrap}>
    <RunningChangesSummary value={current} />
    <ProjectPicker value={project}
      projects={state.projects} hostPicker={hostPicker} running={running} active={active} dropState={drop}
      actions={<>
        {isDesktopApp && <GuiToolbox trigger="git" active={active} connected={!workspaceBusy}
          cwd={project} git={localGitClient} />}
        <LocalProjectBrowser cwd={project} active={active} connected={!workspaceBusy && state.connection === 'ready'} />
      </>}
      disabled={running || state.sending || state.archived || workspaceBusy || reading} gitEnabled={!state.selected}
      onBusyChange={controller.setWorkspaceBusy}
      onChange={controller.setProject} onError={controller.report} />
    {state.selected && <QueuedMessages threadId={state.selected} messages={queuedMessages}
      running={running} connected={state.connection === "ready"} queue={controller.queue}
      editDisabled={disabled || reading || !active} onEdit={editQueuedMessage} />}
    <div ref={composer} className={styles.composer} {...drop.handlers}
      data-file-dragging={drop.dragging || undefined}>
      <ImageAttachments key={`images:${key}`} images={draft.images} active={active}
        disabled={state.sending} onRemove={removeImage} onEdit={editImage} />
      <ComposerReferences key={`references:${key}`} items={draft.attachments ?? []} disabled={disabled}
        active={active} onRemove={removeAttachment} />
      <ComposerQuotes quotes={draft.quotes ?? []} draftKey={key} active={active} disabled={disabled}
        onRemove={removeQuote} onClear={() => { clearQuotes(); skillInput.current?.focus(); }} />
      <input ref={fileInput} type="file" accept={IMAGE_TYPES.join(",")} multiple hidden disabled={disabled}
        aria-label={uiText("client.composer.chooseImages")} onChange={(event) => {
          addImages(Array.from(event.target.files ?? [])); event.target.value = "";
        }} />
      <SkillInput ref={skillInput} value={draft} draftKey={key} cwd={project} active={active}
        suggestion={suggestion.text} onUserInput={suggestion.dismiss} onInputEnd={suggestion.restore}
        conversations={state} onConversation={(reference) => addAttachments([reference])}
        onCoze={(reference) => addAttachments([reference])}
        sshProfiles={desktopSshProfiles} onSsh={reference => addAttachments([reference])}
        onFile={(reference) => addAttachments([reference])}
        connected={state.connection === "ready"} disabled={disabled}
        compact={compactCommand(state, () => void controller.compact())}
        goal={{ enabled: !disabled && !running, run: goalMode.enter }}
        placeholder={state.archived ? uiText("client.composer.restoreThisConversationToContinue") : goalMode.enabled
          ? uiText("client.chat.describeYourGoal") : uiText("client.fileReferences.describeATaskFilesConversationsSkillsCoze")}
        onChange={editContent} onPaste={paste} onPasteKeyDown={pasteKeyDown} onSend={() => void send()} />
      <div className={styles.composerControls}>
        <ComposerAddMenu cwd={project} active={active} disabled={disabled} anchor={composer}
          onFiles={() => setDialog("files")} onGoal={() => setDialog("goal")}
          onPlugin={(plugin) => addAttachments([plugin])} onSkill={(skill) => skillInput.current?.addSkill(skill)} />
        <div className={styles.composerSecondary}>
          <AccessPicker value={state.settings.access}
            disabled={false} onChange={(access: AccessMode) => controller.settings({ access })} />
        </div>
        <div className={styles.modelControls}>
          <div className={styles.composerSecondary}>
            {(goalMode.enabled || goal) && <div className={extras.goalChip}>
              <button type="button" onClick={() => goal && setDialog("goal")}
                title={goal ? `${goal.objective} (${displayText(GOAL_STATUS[goal.status])})` : uiText("client.chat.goalMode")}>
                <Target size={14} /><span>{uiText("client.chat.goal")}</span></button>
              <button type="button" aria-label={uiText("client.mobile.removeGoal")} disabled={disabled || Boolean(state.goalBusy)}
                onClick={async () => {
                  if (goal && state.selected && !await controller.goals.clear(state.selected)) return;
                  goalMode.exit(); skillInput.current?.focus();
                }}><X size={13} /></button>
            </div>}
            <UsageStatus active={active} threadId={state.selected} tokenUsage={current?.tokenUsage}
              tokens={current?.tokens} metrics={metrics} />
          </div>
          <ModelPicker models={state.models} model={state.settings.model} effort={state.settings.effort}
            speed={requestSpeed}
            error={state.modelCatalogError}
            onRetry={() => controller.refreshModels().catch(controller.report)}
            disabled={state.connection !== "ready" || Boolean(state.modelCatalogLoading)}
            onChange={controller.settings} />
          <ComposerDictation key={`dictation:${key}`} active={active && !disabled} disabled={disabled || !active}
            onBusyChange={setDictating}
            onText={(text) => { flushSync(() => appendDictation(text)); skillInput.current?.focus(); }} />
          <ComposerSubmit state={state} controller={controller}
            goalMode={goalMode.enabled}
            hasDraft={hasDraft} reading={reading || workspaceBusy
              || Boolean(state.modelSettingsLoading || state.modelCatalogLoading)} onSend={send} />
        </div>
      </div>
    </div>
    <div className={`${styles.composerHint} cs-usage-footer-container`}>
      <CodexVersionStatus version={cliVersion} read={readCodexServiceStatus} active={active} t={uiText} />
      <ConversationTokenStatus threadId={state.selected} metrics={metrics}
        turns={current?.turns} active={active && state.connection === 'ready'} usage={usageSnapshot.usage} /></div>
    {dialog === "files" && <ComposerFilesDialog onAdd={addAttachments} onImages={() => fileInput.current?.click()}
      onClose={() => setDialog(null)} onError={controller.report} />}
    {dialog === "goal" && <GoalDialog state={state} controller={controller} onClose={() => setDialog(null)} />}
  </div>;
});
