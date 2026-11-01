import { Pressable, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { contextUsage } from '../../../../shared/context-usage/values';
import { remainingStroke } from '../../../../shared/quota';
import { contextUsageLabel } from '../../../../shared/remote-chat/contextUsage';
import { getLocale, t, useLanguage } from '../i18n';
import { settingsContextAmounts } from '../../../../shared/remote-chat/settingsPresentation';
import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { textMetrics } from '../theme/text';
import type { ThreadTokenUsage } from './types';

export function ChatContextProgress({ usage, onSettings }: {
  usage?: ThreadTokenUsage; onSettings?: () => void;
}) {
  const styles = useStyles();
  const color = useThemeColor();
  const language = useLanguage();
  const label = contextUsageLabel(usage, language);
  const percent = contextUsage(usage)?.percent ?? undefined;
  const stroke = percent === undefined ? undefined : remainingStroke(100 - percent);
  return <View style={styles.container}>
    <Pressable accessibilityRole="button" accessibilityLabel={t('client.chat.setContextCapacityForThisChat')}
      accessibilityState={{ disabled: !onSettings }} disabled={!onSettings} onPress={onSettings}
      style={({ pressed }) => [styles.header, pressed && styles.pressed]}>
      <Text style={styles.title}>{t('client.chatSettings.context')}{'  '}
        <Text style={{ color: stroke }}>{percent === undefined ? '—' : `${percent}%`}</Text></Text>
      <View style={styles.details}>
        <Text style={styles.amount}>{settingsContextAmounts(usage, getLocale())}</Text>
        <Feather name="settings" size={18} color={color('#596772', 'muted')} />
      </View>
    </Pressable>
    <View style={styles.track} pointerEvents="none" accessible accessibilityRole="progressbar"
      accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: percent, text: label }}>
      {percent !== undefined && <View style={[styles.fill, {
        width: `${percent}%`, backgroundColor: stroke,
      }]} />}
    </View>
  </View>;
}

const useStyles = createThemedStyles(color => ({
  container: { gap: 6 },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, minHeight: 26 },
  title: { ...textMetrics(15, 22), color: color('#17211b', 'ink'), fontWeight: '600' },
  details: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10,
    flexGrow: 1, flexShrink: 1 },
  amount: { ...textMetrics(13, 20), color: color('#17211b', 'ink'), flexShrink: 1, textAlign: 'right' },
  track: { height: 13, borderRadius: 7, overflow: 'hidden', backgroundColor: color('#dfe8e7', 'elevated') },
  fill: { height: '100%', borderRadius: 7 },
  pressed: { backgroundColor: '#71807814' },
}));
