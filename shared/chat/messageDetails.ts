import type { MessageKey } from '@remoteai/i18n';
import type { Item, Turn } from '../remote-chat/client/types';
import { changedFiles, parseDiff } from './diff';
import { visibleUserContent } from './conversationContext';

const LABELS: Record<string, MessageKey> = {
  userMessage: "client.shared.message", agentMessage: "client.shared.reply", commandExecution: "client.chat.runCommand", fileChange: "client.shared.fileChanges",
  reasoning: "client.shared.reasoning", webSearch: "client.shared.searchTheWeb", mcpToolCall: "client.shared.useTool", dynamicToolCall: "client.shared.useTool",
  functionCallOutput: "client.shared.toolOutput", collabAgentToolCall: "client.chat.collaboration", collabToolCall: "client.chat.collaboration", plan: "client.shared.plan",
  imageView: "client.shared.viewImage", imageGeneration: "client.shared.generateImage", sleep: "client.shared.wait", contextCompaction: "client.shared.compactConversation",
  enteredReviewMode: "client.shared.startCodeReview", exitedReviewMode: "client.shared.codeReviewResults", hookPrompt: "client.shared.taskDetails",
};
export const messageLabel = (item: Item) => LABELS[item.type] ?? "client.shared.taskActivity";

export function messageContent(item: Item) {
  if (item.type === 'userMessage') {
    return visibleUserContent(item.text ? [item.text] : item.content)
      .filter(part => part.type === 'text').map(part => part.text ?? '').filter(Boolean).join('\n');
  }
  return item.text || (item.content ?? [])
    .map((entry) => typeof entry === 'string' ? entry : entry.text ?? '').filter(Boolean).join('\n');
}

export interface DetailSection { title: MessageKey; text: string }
function format(value: unknown): string {
  if (value == null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/** Keep independent tool fields visible; output must not hide errors, arguments or reasoning. */
export function messageSections(item: Item): DetailSection[] {
  const sections: DetailSection[] = [];
  const add = (title: MessageKey, value: unknown) => {
    const text = format(value);
    if (text && !sections.some((section) => section.text === text)) sections.push({ title, text });
  };
  add("client.chat.command", item.command);
  add("client.shared.workingDirectory", item.cwd);
  add("client.shared.summary", item.summary?.join('\n'));
  add("client.chat.content", messageContent(item));
  add("client.chat.output", item.aggregatedOutput);
  add("client.shared.arguments", item.arguments);
  add("client.chat.output", item.output);
  add("client.chat.result", item.result);
  add("client.chat.content", item.contentItems);
  add("client.shared.progress", item.progress?.join('\n'));
  add("client.chat.search", item.action ?? item.query);
  add("client.shared.searchResults", item.results);
  add("client.shared.task", item.prompt);
  add("client.shared.taskStatus", item.agentsStates ?? item.agentStatus);
  add("client.shared.review", item.review);
  add("client.shared.error", item.error ?? item.failure?.message);
  if (item.exitCode != null) add("client.shared.exitCode", String(item.exitCode));
  return sections;
}

export function turnFiles(turn: Turn) {
  const netFiles = parseDiff(turn.diff ?? '');
  if (netFiles.length) return netFiles;
  return changedFiles(turn.items.flatMap((item) => item.changes ?? []));
}
