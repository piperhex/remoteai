import { Settings } from 'lucide-react';
import { Tooltip } from 'antd';
import { contextUsage } from '../../../../shared/context-usage/values';
import { remainingStroke } from '../../../../shared/quota';
import { formatAccountCredits } from '../../../../shared/remote-chat/accountCredits';
import { settingsContextAmounts, settingsCost, settingsQuotaAmounts }
  from '../../../../shared/remote-chat/settingsPresentation';
import { formatThreadTokens, formatTokens, type usageTrailing, type UsageSummary }
  from '../../../../shared/remote-chat/usage';
import type { ConversationMetrics } from '../../../../shared/remote-chat/conversationMetrics';
import { getLocale, t } from '../i18n';
import type { ThreadTokenUsage } from './types';
import { contextUsageLabel } from './formatters';
import { ConversationPerformanceValues } from './ConversationPerformance';
import './chatUsageCard.css';

interface Props {
  usage: UsageSummary | null;
  tokenUsage?: ThreadTokenUsage;
  metrics: ConversationMetrics | null;
  trailing: ReturnType<typeof usageTrailing>;
  notice: string;
  onContextSettings?: () => void;
  disabled: boolean;
}

const TOOLTIP_STYLES = { root: { maxWidth: 400 } };

export function ChatUsageCard({ usage, tokenUsage, metrics, trailing, notice, onContextSettings, disabled }: Props) {
  return <div className="chat-usage-card-stack" role="group" aria-label={t('client.chat.todaySUsage')}>
    <div className="chat-usage-performance"><ConversationPerformanceValues metrics={metrics} /></div>
    <div className="chat-usage-card">
      <ContextMeter tokenUsage={tokenUsage} onSettings={onContextSettings} disabled={disabled} />
      {trailing && <div className="chat-usage-card-quota">
        <Tooltip title={trailing.quota?.description ?? trailing.description} styles={TOOLTIP_STYLES}>
          {trailing.quota ? <div className="chat-usage-card-meter-heading" tabIndex={0}>
            <span>{t('client.chatSettings.quotaRemaining')} <strong>{trailing.text}</strong></span>
            <span className="chat-usage-card-amount">{settingsQuotaAmounts(usage?.estimatedQuota)}</span>
          </div> : <span className="chat-usage-cost" tabIndex={0}>{trailing.text}</span>}
        </Tooltip>
        {trailing.quota && <ProgressBar percent={Math.min(100, Math.max(0, usage?.primaryRemainingPercent ?? 0))}
          color={remainingStroke(Math.round(usage?.primaryRemainingPercent ?? 0))} label={trailing.description} />}
      </div>}
      <div className="chat-usage-card-summary">
        <div className="chat-usage-thread"><span>{t('client.shared.currentChat')}</span>
          <div className="chat-usage-card-tokens"><strong>{formatThreadTokens(tokenUsage?.total.totalTokens)}</strong>
            <span>Token</span></div>
          <span className="chat-usage-cost">{settingsCost(metrics?.estimatedCostUsd)}</span>
        </div>
        <div><span>{t('client.chat.today')}</span>
          {usage ? <><div className="chat-usage-card-tokens"><strong>{formatTokens(usage.totalTokens)}</strong>
            <span>Token</span></div><span className="chat-usage-cost">{settingsCost(usage.estimatedCostUsd)}</span></>
            : <span role="status">{notice}</span>}
        </div>
      </div>
      <div className="chat-usage-credits"><span>{t('client.chat.accountCredits')}</span>{' '}
        <strong className="chat-usage-tokens">{formatAccountCredits(usage?.accountCredits, getLocale(),
          t('client.chat.accountCreditsUnlimited'))}</strong>
      </div>
    </div>
  </div>;
}

function ContextMeter({ tokenUsage, onSettings, disabled }: {
  tokenUsage?: ThreadTokenUsage; onSettings?: () => void; disabled: boolean;
}) {
  const percent = contextUsage(tokenUsage)?.percent ?? undefined;
  const stroke = percent === undefined ? undefined : remainingStroke(100 - percent);
  return <div className="chat-usage-card-context">
    <div className="chat-usage-card-meter-heading">
      <strong>{t('client.chatSettings.context')}{' '}
        <span style={{ color: stroke }}>{percent === undefined ? '—' : `${percent}%`}</span></strong>
      <span className="chat-usage-card-context-details">
        <span className="chat-usage-card-amount">{settingsContextAmounts(tokenUsage, getLocale())}</span>
        <button type="button" aria-label={t('client.chat.conversationContext')}
          disabled={disabled || !onSettings} onClick={onSettings}><Settings size={18} /></button>
      </span>
    </div>
    <ProgressBar percent={percent} color={stroke} label={contextUsageLabel(tokenUsage)} />
  </div>;
}

function ProgressBar({ percent, color, label }: { percent?: number; color?: string; label: string }) {
  return <div className="chat-usage-card-track" role="progressbar" aria-label={label}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={label}>
    {percent !== undefined && <span style={{ width: `${percent}%`, backgroundColor: color }} />}
  </div>;
}
