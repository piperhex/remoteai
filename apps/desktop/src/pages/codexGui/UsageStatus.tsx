import { uiText } from '../../../../../shared/localization/uiText';
import { useEffect, useState } from 'react';
import { ContextUsageButton } from './ContextUsageButton';
import { ContextSettingsDialog } from './ContextSettingsDialog';
import type { ThreadTokenUsage } from '../../../../../shared/conversation/types';
import type { ConversationMetrics } from '../../../../../shared/remote-chat/conversationMetrics';
import { UsageAmounts } from '../../../../../shared/chat/UsageAmounts';
import styles from './UsageStatus.module.less';

export function UsageStatus({ active, threadId, tokenUsage, tokens, metrics }: {
  active: boolean; threadId?: string | null; tokenUsage?: ThreadTokenUsage; tokens?: number;
  metrics?: ConversationMetrics | null;
}) {
  const [contextOpen, setContextOpen] = useState(false);
  const [settingsThread, setSettingsThread] = useState<string | null>(null);
  useEffect(() => { setContextOpen(false); setSettingsThread(null); }, [threadId, active]);
  return <div className={styles.status} onKeyDown={event => {
    if (event.key === 'Escape' && contextOpen) { event.stopPropagation(); setContextOpen(false); }
  }}>
    <span className={styles.usage} role="group" aria-label={uiText('client.chatQuota.currentUsage')}>
      <ContextUsageButton threadId={threadId} usage={tokenUsage} open={active && contextOpen}
        onSettings={threadId ? () => { setContextOpen(false); setSettingsThread(threadId); } : undefined}
        onOpenChange={setContextOpen} />
      <UsageAmounts tokens={tokens ?? tokenUsage?.total.totalTokens} cost={metrics?.estimatedCostUsd}
        scope="current" translate={uiText} />
    </span>
    {active && settingsThread && settingsThread === threadId && <ContextSettingsDialog key={settingsThread}
      threadId={settingsThread} onClose={() => setSettingsThread(null)} />}
  </div>;
}
