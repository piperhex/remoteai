import { uiText } from "../../../../../shared/localization/uiText";
import { contextUsage } from "../../../../../shared/conversation/contextUsage";
import { skillDescription, skillLabel } from "./skillEditorDom";
import type { GuiState, Skill } from "../../../../../shared/conversation/types";

export interface CompactCommand {
  enabled: boolean;
  description: string;
  percent: number | null;
  run: () => void;
}
export type ComposerOption =
  | { kind: "file"; key: string; label: string; description: string; enabled: boolean;
      directory: boolean; command: GoalCommand }
  | { kind: "coze"; key: string; label: string; description: string; enabled: boolean; command: GoalCommand }
  | { kind: "conversation"; key: string; label: string; description: string; enabled: boolean; command: GoalCommand }
  | { kind: "goal"; key: string; label: string; description: string; enabled: boolean; command: GoalCommand }
  | { kind: "compact"; key: string; label: string; description: string; enabled: boolean; command: CompactCommand }
  | { kind: "skill"; key: string; label: string; description: string; enabled: boolean; skill: Skill };

export interface GoalCommand { enabled: boolean; run: () => void }

export function compactUnavailableReason(state: GuiState): string | null {
  const id = state.selected;
  if (state.connection !== "ready") return uiText("client.shared.connectToCompactContext");
  if (!id || !state.conversations[id]) return uiText("client.shared.startAConversationToCompactContext");
  if (state.archived) return uiText("client.shared.restoreTheConversationToCompactContext");
  if (state.compacting) return uiText("client.chat.compactingContext");
  if (state.sending || state.deleting || state.conversations[id].activeTurn
    || state.approvals.some((event) => event.params.threadId === id)) return uiText("client.shared.waitForTheCurrentTaskToFinish");
  if (state.queued[id]?.length) return uiText("client.composer.resolveQueuedMessagesFirst");
  return null;
}

export function compactCommand(state: GuiState, run: () => void): CompactCommand {
  const usage = state.selected ? state.conversations[state.selected]?.tokenUsage : undefined;
  const percent = contextUsage(usage)?.percent ?? null;
  const reason = compactUnavailableReason(state);
  const description = percent === null ? uiText("client.chat.compactThisConversationSContext") : uiText("client.composer.compactThisConversationSContextUsed", { value1: percent });
  return { enabled: reason === null, description: reason ?? description, percent, run };
}

export function composerOptions(skills: Skill[], query: string, command?: CompactCommand,
  goal?: GoalCommand): ComposerOption[] {
  const options: ComposerOption[] = [...(command ? [{ kind: "compact" as const, key: "compact", label: uiText("client.chat.compact"),
    description: command.description, enabled: command.enabled, command }] : []),
  ...(goal ? [{ kind: "goal" as const, key: "goal", label: uiText("client.composer.goalGoal"),
    description: uiText("client.chat.keepWorkingUntilTheGoalIsComplete"), enabled: goal.enabled, command: goal }] : []),
  ...skills.map((skill): ComposerOption => ({ kind: "skill", key: skill.path, label: skillLabel(skill),
    description: skillDescription(skill), enabled: skill.enabled, skill }))];
  return options.filter((option) => {
    const name = option.kind === "skill" ? option.skill.name
      : { compact: "compact 压缩 上下文", goal: "goal 目标", conversation: "对话", coze: "Coze", file: "文件" }[option.kind];
    return `${name} ${option.label} ${option.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  });
}
