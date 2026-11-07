import { uiText } from "../../../../../shared/localization/uiText";
import {
  Activity, Brain, ChevronDown, FilePenLine, Image, ListChecks, Search, Sparkles,
  SquareTerminal, Users, Wrench, Clock, FileSearch, type LucideIcon,
} from "lucide-react";
import type { Item } from "../../../../../shared/conversation/types";
import { ToolDetails } from "./ToolDetails";
import { formatTurnDuration } from "../../../../../shared/conversation/turnTiming";
import { DeferredDetails } from "./DeferredDetails";
import { collaborationSummary, isCollaborationActivity } from "../../../../../shared/conversation/collaborationActivity";
import styles from "./ActivityRow.module.less";
import { commandPreview } from "./commandPreview";
import { activityPreview } from '../../../../../shared/chat/activityPreview';

const TOOL_ACTIVITIES: Record<string, { label: string; icon: LucideIcon }> = {
  fileChange: { get label() { return uiText("client.shared.fileChanges"); }, icon: FilePenLine },
  mcpToolCall: { get label() { return uiText("client.mobile.callingTool"); }, icon: Wrench },
  dynamicToolCall: { get label() { return uiText("client.mobile.callingTool"); }, icon: Wrench },
  webSearch: { get label() { return uiText("client.shared.searchTheWeb"); }, icon: Search },
  contextCompaction: { get label() { return uiText("client.mobile.conversationContextCompacted"); }, icon: ListChecks },
  imageView: { get label() { return uiText("client.shared.viewImage"); }, icon: Image },
  imageGeneration: { get label() { return uiText("client.shared.generateImage"); }, icon: Sparkles },
  plan: { get label() { return uiText("client.mobile.plan"); }, icon: ListChecks },
  sleep: { get label() { return uiText("client.shared.wait"); }, icon: Clock },
  enteredReviewMode: { get label() { return uiText("client.shared.startCodeReview"); }, icon: FileSearch },
  exitedReviewMode: { get label() { return uiText("client.shared.codeReviewResults"); }, icon: FileSearch },
  functionCallOutput: { get label() { return uiText("client.shared.toolOutput"); }, icon: Wrench },
  hookPrompt: { get label() { return uiText("client.shared.taskDetails"); }, icon: ListChecks },
};
const DEFAULT_ACTIVITY = { get label() { return uiText("client.shared.taskActivity"); }, icon: Activity };
const MAX_ACTIVITY_PREVIEW = 160;
const TOOL_STATUS_LABELS: Record<string, string> = {
  get inProgress() { return uiText("client.chat.inProgress"); }, get completed() { return uiText("client.chat.completed"); }, get failed() { return uiText("client.taskReview.failed"); }, get declined() { return uiText("client.chat.declined"); }, get interrupted() { return uiText("client.chat.stopped"); },
};

function commandLabel(status: Item["status"]) {
  if (status === "inProgress") return uiText("client.mobile.running");
  if (status === "completed") return uiText("client.mobile.ran");
  if (status === "failed") return uiText("client.mobile.runFailed");
  if (status === "declined") return uiText("client.chat.declined");
  if (status === "interrupted") return uiText("client.chat.stopped");
  return uiText("client.chat.runCommand");
}

function activitySummary(item: Item, text: string) {
  if (isCollaborationActivity(item)) return { icon: Users, preview: collaborationSummary(item) };
  if (item.type === "reasoning") return { icon: Brain,
    preview: text.slice(0, MAX_ACTIVITY_PREVIEW).trim().split("\n")[0].replace(/[*_`#]/g, "") };
  if (item.type === "commandExecution") {
    const action = item.commandActions?.find((entry) => entry.type !== "unknown");
    const labels: Record<string, string> = { read: uiText("client.chat.readFile"), listFiles: uiText("client.chat.browseFiles"), search: uiText("client.chat.searchCode") };
    const preview = action ? uiText("client.interface.message.7c639b", { value1: labels[action.type] || uiText("client.chat.runCommand"), value2: action.name || action.query || action.path || "" })
      : `${commandLabel(item.status)} ${commandPreview(item.commandPreview ?? item.command ?? "")}`;
    return { icon: SquareTerminal, preview };
  }
  if (item.type === "sleep") return { icon: Clock,
    preview: uiText("client.mobile.wait", { value1: item.durationMs != null ? ` · ${formatTurnDuration(item.durationMs)}` : "" }) };
  if (item.type === "webSearch" && item.action?.type === "openPage") {
    return { icon: Search, preview: uiText("client.mobile.readWebpage", { value1: item.action.url ?? item.query ?? "" }) };
  }
  const { label, icon } = TOOL_ACTIVITIES[item.type] ?? DEFAULT_ACTIVITY;
  const content = item.type === "fileChange"
    ? item.changes?.map((change) => change.path).join("、")
    : item.query || item.tool || item.review || item.text || item.path;
  const status = TOOL_STATUS_LABELS[item.status ?? ""];
  return { icon, preview: [label, content, status].filter(Boolean).join(" · ") };
}

export function ActivitySummary({ item, text, count }: { item: Item; text: string; count?: number }) {
  const reasoning = item.type === "reasoning";
  const summary = activitySummary(item, text);
  const Icon = summary.icon;
  const preview = activityPreview(summary.preview);
  const label = reasoning ? uiText("client.composer.reasoning", { value1: preview }) : preview;
  return <summary className={styles.summary} aria-label={count ? uiText("client.mobile.viewAllActivities", { value1: label, value2: count }) : label}>
      <Icon className={styles.icon} size={15} aria-hidden="true" />
      <span className={styles.preview}>{preview}</span>
      <ChevronDown className={styles.toggle} size={15} aria-hidden="true" />
    </summary>;
}

export function ActivityRow({ item, text }: { item: Item; text: string }) {
  const reasoning = item.type === "reasoning";
  return <DeferredDetails className={styles.row} status={item.status}
    summary={<ActivitySummary item={item} text={text} />}>
    {() => <div className={reasoning ? styles.reasoningBody : styles.commandBody}>
      <ToolDetails item={item} text={text} /></div>}
  </DeferredDetails>;
}
