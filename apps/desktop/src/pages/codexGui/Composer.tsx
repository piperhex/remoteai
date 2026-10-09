import { guiText } from "../../i18n/guiText";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Target, X } from "lucide-react";
import { isDesktopApp } from "../../api/backend";
import { useGoalMode } from "../../../../../shared/remote-chat/client/useGoalMode";
import { ComposerAddMenu } from "./ComposerAddMenu";
import { ComposerFilesDialog } from "./ComposerFilesDialog";
import { ComposerReferences } from "./ComposerReferences";
import { ComposerQuotes } from "./ComposerQuotes";
import type { ReplyQuote } from "./replyQuotes";
import { GoalDialog } from "./GoalDialog";
import { GOAL_STATUS } from "./goalTypes";
import extras from "./ComposerExtras.module.less";
import { AccessPicker } from "./AccessPicker";
import { ComposerSubmit } from "./ComposerSubmit";
import type { GuiController } from "./controller";
import type { AccessMode, GuiState } from "./types";
import { ImageAttachments } from "./ImageAttachments";
import { IMAGE_TYPES, useComposerDraft } from "./useComposerDraft";
import { ModelPicker } from "./ModelPicker";
import { UsageStatus } from "./UsageStatus";
import { ConversationTokenStatus } from './ConversationTokenStatus';
import { ProjectPicker } from "./ProjectPicker";
import { GuiToolbox } from "./GuiToolbox";
import { localGitClient } from "./localGitClient";
import { SkillInput, type SkillInputHandle } from "./SkillInput";
import { compactCommand } from "./composerOptions";
import { QueuedMessages } from "./QueuedMessages";
import { RunningChangesSummary } from "./RunningChangesSummary";
import styles from "./styles.module.less";

export interface ComposerHandle { addQuote: (quote: ReplyQuote) => boolean }

export const Composer = forwardRef<ComposerHandle, {
  state: GuiState; controller: GuiController; active: boolean; hostPicker?: ReactNode;
}>(function Composer({ state, controller, active, hostPicker }, ref) {
  const fileInput = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const skillInput = useRef<SkillInputHandle>(null);
  const key = state.selected ?? "new";
  const [dialog, setDialog] = useState<"files" | "goal" | null>(null);
  const goalMode = useGoalMode(state.selected, Boolean(state.goalBusy));
  const workspaceBusy = Boolean(state.workspaceBusy);
  const { draft, reading, editContent, removeImage, editImage, addImages, paste, pasteKeyDown, send: sendDraft,
    addAttachments, removeAttachment, addQuote, removeQuote, clearQuotes, editQueued } = useComposerDraft(key, controller);
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
  const hasDraft = Boolean(draft.text.trim() || draft.images.length
    || draft.attachments?.length || draft.quotes?.length);
  useImperativeHandle(ref, () => ({ addQuote: (quote) => {
    if (disabled || !active || !current?.turns.some((turn) => turn.items.some((item) =>
      item.id === quote.messageId && item.type === "agentMessage"))) return false;
    if (!addQuote(quote)) return false;
    skillInput.current?.focus();
    return true;
  } }));
  const goal = state.selected ? state.goals?.[state.selected] : null;
  const canSend = !disabled && !reading && !state.modelSettingsLoading && !state.modelCatalogLoading
    && hasDraft;
  const send = async () => {
    if (!canSend) return;
    await sendDraft(goalMode.enabled, goalMode.exit);
  };
  const editQueuedMessage = (id: string) => {
    if (disabled || reading || !active) return;
    let restored = false;
    flushSync(() => { restored = editQueued(id); });
    if (restored) skillInput.current?.focus();
  };
  return <div className={styles.composerWrap}>
    <RunningChangesSummary value={current} />
    {(!running || isDesktopApp || hostPicker) && <ProjectPicker key={key} value={project}
      projects={state.projects} hostPicker={hostPicker} running={running}
      actions={isDesktopApp && <GuiToolbox trigger="git" active={active} connected={!workspaceBusy}
        cwd={project} deviceName={guiText("本机")} git={localGitClient} />}
      disabled={running || state.sending || state.archived || workspaceBusy} gitEnabled={!state.selected}
      onBusyChange={controller.setWorkspaceBusy}
      onChange={controller.setProject} onError={controller.report} />}
    {state.selected && <QueuedMessages threadId={state.selected} messages={queuedMessages}
      running={running} connected={state.connection === "ready"} queue={controller.queue}
      editDisabled={disabled || reading || !active} onEdit={editQueuedMessage} />}
    <div ref={composer} className={styles.composer}>
      <ImageAttachments key={`images:${key}`} images={draft.images} active={active}
        disabled={state.sending} onRemove={removeImage} onEdit={editImage} />
      <ComposerReferences key={`references:${key}`} items={draft.attachments ?? []} disabled={disabled}
        active={active} onRemove={removeAttachment} />
      <ComposerQuotes quotes={draft.quotes ?? []} draftKey={key} active={active} disabled={disabled}
        onRemove={removeQuote} onClear={() => { clearQuotes(); skillInput.current?.focus(); }} />
      <input ref={fileInput} type="file" accept={IMAGE_TYPES.join(",")} multiple hidden disabled={disabled}
        aria-label={guiText("选择图片")} onChange={(event) => {
          addImages(Array.from(event.target.files ?? [])); event.target.value = "";
        }} />
      <SkillInput ref={skillInput} value={draft} draftKey={key} cwd={project} active={active}
        conversations={state} onConversation={(reference) => addAttachments([reference])}
        connected={state.connection === "ready"} disabled={disabled}
        compact={compactCommand(state, () => void controller.compact())}
        goal={{ enabled: !disabled && !running, run: goalMode.enter }}
        placeholder={state.archived ? guiText("恢复对话后即可继续") : goalMode.enabled
          ? guiText("描述想完成的目标…") : guiText("描述任务，@ 引用对话，/ 选择命令和技能…")}
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
                title={goal ? `${goal.objective} (${guiText(GOAL_STATUS[goal.status])})` : guiText("目标模式")}>
                <Target size={14} /><span>{guiText("目标")}</span></button>
              <button type="button" aria-label={guiText("移除目标")} disabled={disabled || Boolean(state.goalBusy)}
                onClick={async () => {
                  if (goal && state.selected && !await controller.goals.clear(state.selected)) return;
                  goalMode.exit(); skillInput.current?.focus();
                }}><X size={13} /></button>
            </div>}
            <UsageStatus active={active} threadId={state.selected} tokenUsage={current?.tokenUsage} />
          </div>
          <ModelPicker models={state.models} model={state.settings.model} effort={state.settings.effort}
            error={state.modelCatalogError}
            onOpen={() => void controller.refreshModels().catch(controller.report)}
            disabled={state.connection !== "ready" || Boolean(state.modelCatalogLoading)}
            onChange={controller.settings} />
          <ComposerSubmit state={state} controller={controller}
            goalMode={goalMode.enabled}
            hasDraft={hasDraft} reading={reading || workspaceBusy
              || Boolean(state.modelSettingsLoading || state.modelCatalogLoading)} onSend={send} />
        </div>
      </div>
    </div>
    <div className={styles.composerHint}><span>{guiText("Enter 发送 · Shift + Enter 换行")}</span>
      <ConversationTokenStatus threadId={state.selected} tokens={current?.tokens ?? 0}
        active={active && state.connection === 'ready'} /></div>
    {dialog === "files" && <ComposerFilesDialog onAdd={addAttachments} onImages={() => fileInput.current?.click()}
      onClose={() => setDialog(null)} onError={controller.report} />}
    {dialog === "goal" && <GoalDialog state={state} controller={controller} onClose={() => setDialog(null)} />}
  </div>;
});
