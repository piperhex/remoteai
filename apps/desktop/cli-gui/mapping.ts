import type { PaseoAgent } from '@getpaseo/client';
import type { AgentPermissionRequest, AgentTimelineItem, ToolCallDetail } from '@getpaseo/protocol/agent-types';
import type { CliEntry, CliPermission, CliSession, ExternalEngine } from '../../../shared/cli-gui/types';

export function session(agent: PaseoAgent, engine: ExternalEngine): CliSession {
  return { id: agent.id, engine, title: agent.title ?? '', cwd: agent.cwd, model: agent.model ?? '',
    status: agent.status, updatedAt: agent.updatedAt, archived: Boolean(agent.archivedAt),
    permissions: agent.pendingPermissions.map(permission) };
}

export function permission(request: AgentPermissionRequest): CliPermission {
  const questions = request.kind === 'question' && Array.isArray(request.input?.questions)
    ? request.input.questions.flatMap(value => {
      if (!value || typeof value !== 'object' || !('question' in value) || typeof value.question !== 'string') return [];
      const input = value as { question: string; options?: { label?: unknown }[]; multiSelect?: boolean };
      return [{ question: input.question, multiple: input.multiSelect,
        options: (input.options ?? []).flatMap(option => typeof option.label === 'string' ? [option.label] : []) }];
    }) : undefined;
  return { id: request.id, title: request.title || request.name, description: request.description,
    actions: request.actions?.length ? request.actions.map(({ id, label, behavior }) => ({ id, label, behavior })) : [
      { id: 'allow', label: '', behavior: 'allow' }, { id: 'deny', label: '', behavior: 'deny' },
    ], questions };
}

function toolText(detail: ToolCallDetail): string {
  switch (detail.type) {
    case 'shell': return [detail.command, detail.output].filter(Boolean).join('\n');
    case 'read': return [detail.filePath, detail.content].filter(Boolean).join('\n');
    case 'write': return [detail.filePath, detail.content].filter(Boolean).join('\n');
    case 'edit': return [detail.filePath, detail.unifiedDiff ?? detail.newString].filter(Boolean).join('\n');
    case 'plain_text': return detail.text ?? '';
    case 'plan': return detail.text;
    case 'search': return [detail.query, detail.content].filter(Boolean).join('\n');
    default: return JSON.stringify(detail, null, 2);
  }
}

export function timelineEntry(item: AgentTimelineItem, first: number, last: number): CliEntry {
  const base = { id: String(first), first, last };
  switch (item.type) {
    case 'user_message': return { ...base, role: 'user', text: item.text };
    case 'assistant_message': return { ...base, role: 'assistant', text: item.text };
    case 'reasoning': return { ...base, role: 'reasoning', text: item.text };
    case 'tool_call': return { ...base, role: 'tool', text: toolText(item.detail), title: item.name, status: item.status };
    case 'error': return { ...base, role: 'error', text: item.message };
    case 'notification': return { ...base, role: 'notice', text: item.message };
    default: return { ...base, role: 'notice', text: '' };
  }
}
