import { displayText } from '../i18n/index';
import { displayError } from '../i18n/index';
import { createThemedStyles } from '../theme/styles';
import { textMetrics } from '../theme/text';
import { getLocale, t, useLanguage } from '../i18n';
import { formatAccountCredits } from '../../../../shared/remote-chat/accountCredits';
import { Text, View } from 'react-native';
import { useChatUsage } from '../../../../shared/remote-chat/client/useChatUsage';
import { formatCost, formatThreadTokens, formatTokens, usageTrailing,
  type ReadUsage } from '../../../../shared/remote-chat/usage';
import { palette } from './styles';
import type { ThreadTokenUsage } from './types';
import { formatConversationCost, type ReadConversationMetrics } from '../../../../shared/remote-chat/conversationMetrics';
import { useConversationMetrics } from '../../../../shared/remote-chat/client/useConversationMetrics';
import { ConversationPerformanceValues } from './ConversationPerformance';
import { ChatQuotaProgress } from './ChatQuotaProgress';
import { ChatContextProgress } from './ChatContextProgress';

export function ChatUsage({ read, active, ready, tokenUsage, onContextSettings, readConversationMetrics, threadId }: {
  read: ReadUsage; active: boolean; ready: boolean; tokenUsage?: ThreadTokenUsage;
  readConversationMetrics: ReadConversationMetrics; threadId: string | null;
  onContextSettings?: () => void;
}) {
  const styles = useStyles();
  useLanguage();
  const { usage, error } = useChatUsage(read, active && ready);
  const metrics = useConversationMetrics(readConversationMetrics, threadId, active && ready);
  const trailing = usageTrailing(usage, displayText, formatCost, { compactQuota: true });
  const notice = ready ? (error ? displayError(error) : t("client.chat.loadingTodaySUsage")) : t("client.chat.connectToViewTodaySUsage");
  return <View style={styles.container}>
    <ChatContextProgress usage={tokenUsage} onSettings={onContextSettings} />
    {trailing && <ChatQuotaProgress trailing={trailing} remaining={usage?.primaryRemainingPercent ?? 0} />}
    <View style={styles.summary}>
      <Text style={styles.row}>{t("client.shared.currentChat")}{' '}
        <Text style={styles.tokens}>{formatThreadTokens(tokenUsage?.total.totalTokens)} Token</Text>
        {' · '}<Text style={styles.cost}>{formatConversationCost(metrics)}</Text>
      </Text>
      {usage ? <Text style={styles.row} accessibilityLabel={[
        t("client.mobile.todaySTokenUsage", { value1: usage.totalTokens.toLocaleString('en-US') }),
        t("client.mobile.todaySEstimatedCost", { value1: formatCost(usage.estimatedCostUsd) }),
      ].filter(Boolean).join('，')}>
        {t("client.chat.today")}{' '}<Text style={styles.tokens}>{formatTokens(usage.totalTokens)} Token</Text>
        {' · '}<Text style={styles.cost}>{formatCost(usage.estimatedCostUsd)}</Text>
      </Text> : <Text style={styles.row}>{notice}</Text>}
      <Text style={styles.row}>{t('client.chat.accountCredits')}{' '}
        <Text style={styles.tokens}>{formatAccountCredits(usage?.accountCredits, getLocale(),
          t('client.chat.accountCreditsUnlimited'))}</Text>
      </Text>
      <Text style={styles.row}><ConversationPerformanceValues metrics={metrics} /></Text>
    </View>
  </View>;
}

const useStyles = createThemedStyles((color) => ({
  container: { paddingTop: 14, gap: 4 },
  summary: { padding: 12, gap: 4, borderRadius: 12, backgroundColor: color('#eef3f0', 'canvas') },
  row: { color: color(palette.muted, 'muted'), ...textMetrics(12, 20), flexShrink: 1 },
  tokens: { color: color(palette.green, 'accent'), fontWeight: '600' },
  cost: { color: color('#b45d00', 'warning'), fontWeight: '600' },
}));
