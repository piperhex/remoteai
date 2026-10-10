import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useChatUsage } from '../../../../shared/remote-chat/client/useChatUsage';
import { formatCost, formatThreadTokens, formatTokens, usageTrailing,
  type ReadUsage } from '../../../../shared/remote-chat/usage';
import { palette } from './styles';
import { contextUsageLabel } from '../../../../shared/remote-chat/contextUsage';
import type { ThreadTokenUsage } from './types';
import type { ReadConversationMetrics } from '../../../../shared/remote-chat/conversationMetrics';
import { ConversationPerformance } from './ConversationPerformance';

export function ChatUsage({ read, active, ready, tokenUsage, onContextSettings, readConversationMetrics, threadId }: {
  read: ReadUsage; active: boolean; ready: boolean; tokenUsage?: ThreadTokenUsage;
  readConversationMetrics: ReadConversationMetrics; threadId: string | null;
  onContextSettings?: () => void;
}) {
  const styles = useStyles();
  const color = useThemeColor();
  const language = useLanguage();
  const { usage, error } = useChatUsage(read, active && ready);
  const trailing = usageTrailing(usage, t);
  const notice = ready ? error || t("正在读取今日用量…") : t("连接后查看今日用量");
  return <View style={styles.container}>
    <View style={styles.context}>
      <Text style={[styles.row, styles.contextText]}>{contextUsageLabel(tokenUsage, language)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t("设置当前对话的上下文容量")}
        accessibilityState={{ disabled: !onContextSettings }} disabled={!onContextSettings}
        style={({ pressed }) => [styles.settings, pressed && styles.pressed, !onContextSettings && styles.disabled]}
        onPress={onContextSettings}>
        <Feather name="settings" size={16} color={color(palette.muted, 'muted')} />
      </Pressable>
    </View>
    {usage ? <Text style={styles.row} accessibilityLabel={[
      t("今日 Token 用量：{value1}", { value1: usage.totalTokens.toLocaleString('en-US') }),
      t("今日预估费用：{value1}", { value1: formatCost(usage.estimatedCostUsd) }), trailing?.description,
    ].filter(Boolean).join('，')}>
      {t("今日")}{' '}<Text style={styles.tokens}>{formatTokens(usage.totalTokens)} Token</Text>
      {t(" · 预估 ")}<Text style={styles.cost}>{formatCost(usage.estimatedCostUsd)}</Text>
      {trailing && <Text>{' · '}{trailing.label}
        <Text style={styles[trailing.tone]}>{trailing.text}</Text></Text>}
    </Text> : <Text style={styles.row}>{notice}</Text>}
    <Text style={styles.row}>{t("当前对话")}{' '}
      <Text style={styles.tokens}>{formatThreadTokens(tokenUsage?.total.totalTokens)} Token</Text>
      {' · '}<ConversationPerformance read={readConversationMetrics} threadId={threadId} active={active && ready} />
    </Text>
  </View>;
}

const useStyles = createThemedStyles((color) => ({
  context: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  contextText: { flex: 1 },
  settings: { minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  pressed: { backgroundColor: color(palette.pale, 'accentSoft') },
  disabled: { opacity: 0.4 },
  container: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color(palette.border, 'border'), paddingTop: 14, gap: 4 },
  row: { color: color(palette.muted, 'muted'), fontSize: 12, lineHeight: 20, flexShrink: 1 },
  tokens: { color: color(palette.green, 'accent'), fontWeight: '600' },
  cost: { color: color('#b45d00', 'warning'), fontWeight: '600' },
  quota: { color: color('#16874e', 'accent'), fontWeight: '600' },
  low: { color: color(palette.danger, 'danger'), fontWeight: '600' },
}));
