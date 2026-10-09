import { t, useLanguage } from '../i18n';
import { useEffect, useState, type ReactNode } from 'react';
import { Settings } from 'lucide-react';
import { Tooltip } from 'antd';
import { useChatUsage } from '../../../../shared/remote-chat/client/useChatUsage';
import { formatCost, formatThreadTokens, formatTokens, usageTrailing,
  type ReadUsage } from '../../../../shared/remote-chat/usage';
import './chatUsage.css';
import { contextUsageLabel } from './formatters';
import type { ThreadTokenUsage } from './types';
import type { ReadConversationMetrics } from '../../../../shared/remote-chat/conversationMetrics';
import { ConversationTps } from './ConversationTps';

export function ChatUsage({ read, active, ready, tokenUsage, onContextSettings, inline = false, contextControl,
  readConversationMetrics, threadId }: {
  read: ReadUsage; active: boolean; ready: boolean; tokenUsage?: ThreadTokenUsage;
  onContextSettings?: () => void; inline?: boolean; contextControl?: ReactNode;
  readConversationMetrics?: ReadConversationMetrics; threadId?: string | null;
}) {
  useLanguage();
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const { usage, error } = useChatUsage(read, active && ready && visible);
  const trailing = usageTrailing(usage, t);
  const notice = ready ? (error ? t(error) : t("正在读取今日用量…")) : t("连接后查看今日用量");
  if (inline) return <InlineUsage usage={usage} notice={notice} contextControl={contextControl} />;
  return <div className="chat-usage" role="group" aria-label={t("今日用量")}>
    <span className="chat-usage-context chat-row"><span className="chat-grow">{contextUsageLabel(tokenUsage)}</span>
      {onContextSettings && <button type="button" className="chat-back" aria-label={t("对话上下文设置")}
        disabled={!ready || !active} onClick={onContextSettings}><Settings size={18} /></button>}</span>
    {usage ? <>
      <span>{t("今日")} <strong className="chat-usage-tokens">{formatTokens(usage.totalTokens)} Token</strong></span>
      <span>{t("· 预估")} <strong className="chat-usage-cost">{formatCost(usage.estimatedCostUsd)}</strong></span>
      {trailing && <span aria-label={trailing.description}>· {t(trailing.label)}
        <strong className={`chat-usage-${trailing.tone}`}>{trailing.text}</strong></span>}
    </> : <span>{notice}</span>}
    <span className="chat-usage-thread">{t("当前对话")}{' '}
      <strong className="chat-usage-tokens">{formatThreadTokens(tokenUsage?.total.totalTokens)} Token</strong>
      {readConversationMetrics && <> · <ConversationTps read={readConversationMetrics} threadId={threadId ?? null}
        active={active && ready && visible} /></>}
    </span>
  </div>;
}

const USAGE_TOOLTIP_STYLES = { root: { maxWidth: 400 }, body: { fontSize: 12, overflowWrap: 'anywhere' } } as const;

function InlineUsage({ usage, notice, contextControl }: {
  usage: ReturnType<typeof useChatUsage>['usage']; notice: string; contextControl?: ReactNode;
}) {
  const trailing = usageTrailing(usage, t);
  return <div className="chat-composer-usage" role="group" aria-label={t('今日用量')}>
    {contextControl}
    <span>{t('今日')}</span>
    <Tooltip title={usage ? `${usage.totalTokens.toLocaleString()} Token` : notice} styles={USAGE_TOOLTIP_STYLES}>
      <strong className="chat-usage-tokens" tabIndex={0}>{usage ? formatTokens(usage.totalTokens) : '—'}</strong>
    </Tooltip>
    <span>·</span>
    <Tooltip title={usage ? t('预估费用') : notice} styles={USAGE_TOOLTIP_STYLES}>
      <strong className="chat-usage-cost" tabIndex={0}>{usage ? formatCost(usage.estimatedCostUsd) : '—'}</strong>
    </Tooltip>
    {trailing && <><span>·</span><Tooltip title={trailing.description} styles={USAGE_TOOLTIP_STYLES}>
      <strong className={`chat-usage-${trailing.tone}`} tabIndex={0}>{trailing.text}</strong>
    </Tooltip></>}
  </div>;
}
