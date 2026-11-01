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
import { type ReadConversationMetrics } from '../../../../shared/remote-chat/conversationMetrics';
import { settingsCost } from '../../../../shared/remote-chat/settingsPresentation';
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
    <Text style={styles.performance}><ConversationPerformanceValues metrics={metrics} /></Text>
    <View style={styles.card}>
      <ChatContextProgress usage={tokenUsage} onSettings={onContextSettings} />
      {trailing && <ChatQuotaProgress trailing={trailing} remaining={usage?.primaryRemainingPercent ?? 0}
        estimate={usage?.estimatedQuota} />}
      <View style={styles.summary}>
        <View style={styles.column}>
          <Text style={styles.label}>{t('client.shared.currentChat')}</Text>
          <Text style={styles.tokens}>{formatThreadTokens(tokenUsage?.total.totalTokens)}
            <Text style={styles.unit}> Token</Text></Text>
          <Text style={styles.cost}>{settingsCost(metrics?.estimatedCostUsd)}</Text>
        </View>
        <View style={[styles.column, styles.today]}>
          <Text style={styles.label}>{t('client.chat.today')}</Text>
          {usage ? <>
            <Text style={styles.tokens} accessibilityLabel={t('client.mobile.todaySTokenUsage', {
              value1: usage.totalTokens.toLocaleString('en-US'),
            })}>{formatTokens(usage.totalTokens)}<Text style={styles.unit}> Token</Text></Text>
            <Text style={styles.cost}>{settingsCost(usage.estimatedCostUsd)}</Text>
          </> : <Text style={styles.label}>{notice}</Text>}
        </View>
      </View>
      <View style={styles.credits}>
        <Text style={styles.label}>{t('client.chat.accountCredits')}</Text>
        <Text style={styles.creditValue}>{formatAccountCredits(usage?.accountCredits, getLocale(),
          t('client.chat.accountCreditsUnlimited'))}</Text>
      </View>
    </View>
  </View>;
}

const useStyles = createThemedStyles((color) => ({
  container: { gap: 8 },
  performance: { ...textMetrics(12, 14), color: color('#596772', 'muted'), textAlign: 'center' },
  card: { padding: 14, gap: 8, borderRadius: 12, backgroundColor: color('#eef5f4', 'canvas') },
  summary: { flexDirection: 'row', paddingTop: 8, borderTopWidth: 1, borderTopColor: color('#dfe8e7', 'border') },
  column: { flex: 1, minWidth: 0, paddingRight: 10 },
  today: { paddingLeft: 16, paddingRight: 0, borderLeftWidth: 1, borderLeftColor: color('#dfe8e7', 'border') },
  label: { ...textMetrics(13, 16), color: color('#596772', 'muted'), flexShrink: 1 },
  tokens: { ...textMetrics(24, 26), color: color(palette.green, 'accent'), fontWeight: '600' },
  unit: { fontSize: 13, fontWeight: '400' },
  cost: { ...textMetrics(15, 18), color: color('#b45d00', 'warning'), fontWeight: '500' },
  credits: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: color('#dfe8e7', 'border') },
  creditValue: { ...textMetrics(15, 20), color: color(palette.green, 'accent'), fontWeight: '600',
    flexGrow: 1, flexShrink: 1, textAlign: 'right' },
}));
