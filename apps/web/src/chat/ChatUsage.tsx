import { displayError, displayText } from '../i18n/index';
import { getLocale, t, useLanguage } from '../i18n';
import { formatAccountCredits } from '../../../../shared/remote-chat/accountCredits';
import { Tooltip } from 'antd';
import { useVisibleChatUsage } from './useVisibleChatUsage';
import { formatCost, formatThreadTokens, formatTokens, usageTrailing,
  type ReadUsage } from '../../../../shared/remote-chat/usage';
import './chatUsage.css';
import type { ThreadTokenUsage } from './types';
import { formatConversationCost, type ReadConversationMetrics } from '../../../../shared/remote-chat/conversationMetrics';
import { useConversationMetrics } from '../../../../shared/remote-chat/client/useConversationMetrics';
import { ConversationPerformanceValues } from './ConversationPerformance';
import { QuotaProgress } from '../../../../shared/chat/QuotaProgress';
import { ChatContextProgress } from './ChatContextProgress';
import { ChatUsageCard } from './ChatUsageCard';

export function ChatUsage({ read, active, ready, tokenUsage, onContextSettings,
  quotaProgress = false, showAccountCredits = false, card = false,
  readConversationMetrics, threadId }: {
  read: ReadUsage; active: boolean; ready: boolean; tokenUsage?: ThreadTokenUsage;
  onContextSettings?: () => void;
  quotaProgress?: boolean;
  showAccountCredits?: boolean;
  card?: boolean;
  readConversationMetrics?: ReadConversationMetrics; threadId?: string | null;
}) {
  useLanguage();
  const { usage, error, visible } = useVisibleChatUsage(read, active && ready);
  const metrics = useConversationMetrics(readConversationMetrics, threadId ?? null, active && ready && visible);
  const trailing = usageTrailing(usage, displayText, formatCost, { compactQuota: quotaProgress });
  const notice = ready ? (error ? displayError(error) : t("client.chat.loadingTodaySUsage")) : t("client.chat.connectToViewTodaySUsage");
  if (card) return <ChatUsageCard usage={usage} tokenUsage={tokenUsage} metrics={metrics} trailing={trailing}
    notice={notice} onContextSettings={onContextSettings} disabled={!ready || !active} />;
  return <div className="chat-usage" role="group" aria-label={t("client.chat.todaySUsage")}>
    <ChatContextProgress usage={tokenUsage} onSettings={onContextSettings} disabled={!ready || !active} />
    {usage && trailing && <QuotaLine trailing={trailing}
      remaining={quotaProgress ? usage.primaryRemainingPercent ?? undefined : undefined} />}
    <div className="chat-usage-summary">
      <span className="chat-usage-thread">{t("client.shared.currentChat")}{' '}
        <strong className="chat-usage-tokens">{formatThreadTokens(tokenUsage?.total.totalTokens)} Token</strong>
        {' · '}<strong className="chat-usage-cost">{formatConversationCost(metrics)}</strong>
      </span>
      {usage ? <>
        <span>{t("client.chat.today")} <strong className="chat-usage-tokens">{formatTokens(usage.totalTokens)} Token</strong></span>
        <span>· <strong className="chat-usage-cost">{formatCost(usage.estimatedCostUsd)}</strong></span>
      </> : <span>{notice}</span>}
      {showAccountCredits && <span className="chat-usage-credits">{t('client.chat.accountCredits')}{' '}
        <strong className="chat-usage-tokens">{formatAccountCredits(usage?.accountCredits, getLocale(),
          t('client.chat.accountCreditsUnlimited'))}</strong>
      </span>}
      {readConversationMetrics && <span className="chat-usage-performance">
        <ConversationPerformanceValues metrics={metrics} />
      </span>}
    </div>
  </div>;
}

const USAGE_TOOLTIP_STYLES = { root: { maxWidth: 400 }, body: { fontSize: 12, overflowWrap: 'anywhere' } } as const;

function QuotaLine({ trailing, remaining }: {
  trailing: NonNullable<ReturnType<typeof usageTrailing>>; remaining?: number;
}) {
  const content = <>
    <Tooltip title={trailing.description} styles={USAGE_TOOLTIP_STYLES}>
      <strong className={`chat-usage-${trailing.tone}`} tabIndex={0}>{trailing.text}</strong>
    </Tooltip>
    {trailing.quota && <Tooltip title={trailing.quota.description} styles={USAGE_TOOLTIP_STYLES}>
      <span tabIndex={0}> · {trailing.quota.remaining} · {trailing.quota.total}</span>
    </Tooltip>}
  </>;
  return <span className="chat-usage-quota-line">{remaining === undefined ? content
    : <QuotaProgress trailing={trailing} remaining={remaining}>{content}</QuotaProgress>}</span>;
}
