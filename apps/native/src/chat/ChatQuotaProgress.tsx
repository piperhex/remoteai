import { Text, View } from 'react-native';
import type { usageTrailing, UsageSummary } from '../../../../shared/remote-chat/usage';
import { settingsQuotaAmounts } from '../../../../shared/remote-chat/settingsPresentation';
import { remainingStroke } from '../../../../shared/quota';
import { createThemedStyles } from '../theme/styles';
import { textMetrics } from '../theme/text';
import { t } from '../i18n';

export function ChatQuotaProgress({ trailing, remaining, estimate }: {
  trailing: NonNullable<ReturnType<typeof usageTrailing>>; remaining: number;
  estimate?: UsageSummary['estimatedQuota'];
}) {
  const styles = useStyles();
  const { quota } = trailing;
  if (!quota) return <Text style={styles.api} accessibilityLabel={trailing.description}>{trailing.text}</Text>;
  const text = `${trailing.text} · ${quota.remaining} · ${quota.total}`;
  const percent = Math.min(100, Math.max(0, remaining));
  return <View style={styles.container} accessible accessibilityRole="progressbar" accessibilityLabel={trailing.description}
    accessibilityHint={quota.description} accessibilityValue={{ min: 0, max: 100, now: percent, text }}>
    <View style={styles.header}>
      <Text style={styles.label}>{t('client.chatSettings.quotaRemaining')}{'  '}
        <Text style={styles.percent}>{trailing.text}</Text></Text>
      <Text style={styles.amount}>{settingsQuotaAmounts(estimate)}</Text>
    </View>
    <View style={styles.track} pointerEvents="none" accessible={false}>
      <View style={[styles.fill, { width: `${percent}%`, backgroundColor: remainingStroke(Math.round(remaining)) }]} />
    </View>
  </View>;
}

const useStyles = createThemedStyles(color => ({
  container: { gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: color('#dfe8e7', 'border') },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  label: { ...textMetrics(13, 20), color: color('#596772', 'muted') },
  amount: { ...textMetrics(13, 20), color: color('#17211b', 'ink'), flexGrow: 1, flexShrink: 1, textAlign: 'right' },
  track: { height: 13, borderRadius: 7, overflow: 'hidden', backgroundColor: color('#dfe8e7', 'elevated') },
  fill: { height: '100%', borderRadius: 7 },
  percent: { fontWeight: '600', color: color('#17211b', 'ink') },
  api: { ...textMetrics(12, 20), color: color('#b45d00', 'warning'), fontWeight: '600' },
}));
