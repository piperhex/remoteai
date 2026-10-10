import { t, useLanguage } from '../i18n';
import { useState, type ReactNode } from 'react';
import { ChevronRight, FileText, Lightbulb, Search, Terminal, Users, Wrench } from 'lucide-react';
import { ChatToolContent } from './ChatToolContent';
import type { Item } from './types';
import { messageContent, messageLabel } from '../../../../shared/chat/messageDetails';
import { commandPreview } from '../../../../shared/chat/commandPreview';
import { collaborationSummary, isCollaborationActivity }
  from '../../../desktop/src/pages/codexGui/collaborationActivity';

const STATUS: Record<string, string> = { get inProgress() { return t("进行中"); }, get completed() { return t("已完成"); }, get failed() { return t("失败"); },
  get declined() { return t("已拒绝"); }, get interrupted() { return t("已停止"); } };

function activityLabel(item: Item) {
  if (isCollaborationActivity(item)) return collaborationSummary(item, t);
  if (item.type === 'commandExecution') {
    const action = item.commandActions?.find(entry => entry.type !== 'unknown');
    const labels: Record<string, string> = { read: t("读取文件"), listFiles: t("浏览文件"), search: t("搜索代码") };
    return action ? `${labels[action.type] || t("执行命令")} · ${action.name || action.query || action.path || ''}`
      : [t("执行命令"), commandPreview(item.command ?? ''), item.status === 'interrupted' ? t("已停止") : '']
        .filter(Boolean).join(' · ');
  }
  if (item.type === 'reasoning') return [...item.summary ?? [], messageContent(item)]
    .join('\n').trim().split('\n')[0].replace(/[*_`#]/g, '');
  const detail = item.type === 'fileChange'
    ? item.changes?.map(change => change.path.split(/[\\/]/).at(-1)).join('、')
    : item.query || item.tool || item.review || item.text || item.path;
  return [t(messageLabel(item)), detail, STATUS[item.status ?? '']].filter(Boolean).join(' · ');
}

export function ChatActivity({ item, onOpen, running, inline = false, onInspect, count, content }: {
  item: Item; onOpen: (id: string) => void; running?: boolean;
  inline?: boolean; onInspect?: () => void; count?: number; content?: ReactNode;
}) {
  useLanguage();
  const [expanded, setExpanded] = useState(false);
  const label = activityLabel(item).slice(0, 160).replace(/\s+/g, ' ').trim();
  if (!label) return null;
  const icons = { commandExecution: Terminal, fileChange: FileText, reasoning: Lightbulb, webSearch: Search };
  const Icon = isCollaborationActivity(item) ? Users : icons[item.type as keyof typeof icons] || Wrench;
  return <div className={inline ? 'chat-inline-activity' : undefined}>
    <button type="button" className={`chat-activity${running ? ' is-running' : ''}`}
      aria-label={count ? t('查看连续操作，{value1} 项活动', { value1: count }) : undefined}
      aria-expanded={inline ? expanded : undefined} onClick={() => {
        if (!inline) return onOpen(item.id);
        if (!expanded) onInspect?.();
        setExpanded(value => !value);
      }}><Icon size={16} color={item.status === 'failed' ? 'var(--danger, #c24047)' : undefined} />
      <span className="chat-activity-text">{label}</span>
      {count && <span className="chat-activity-count">{count}</span>}<ChevronRight size={15} /></button>
    {inline && expanded && <div className="chat-inline-tool-content chat-detail-stack">
      {content ?? <ChatToolContent item={item} />}
    </div>}
  </div>;
}
