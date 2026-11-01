import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { t, useLanguage } from '../i18n';
import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { textMetrics } from '../theme/text';
import { deviceColors } from './styles';

export function DevicePageHeader({ onBack, onRefresh, refreshing }: {
  onBack: () => void;
  onRefresh: () => Promise<void>;
  refreshing: boolean;
}) {
  useLanguage();
  const styles = useStyles();
  const color = useThemeColor();
  return <View style={styles.header}>
    <View style={styles.side}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('client.discovery.back')} onPress={onBack}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
        <Ionicons name="chevron-back" size={22} color={color(deviceColors.ink, 'ink')} />
        <Text style={styles.backLabel}>{t('client.discovery.title')}</Text>
      </Pressable>
    </View>
    <Text accessibilityRole="header" style={styles.title}>{t('client.app.devices.7e708d')}</Text>
    <View style={[styles.side, styles.right]}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('client.app.refreshDeviceList')}
        disabled={refreshing} accessibilityState={{ disabled: refreshing, busy: refreshing }}
        onPress={() => void onRefresh()} style={({ pressed }) => [styles.refresh, pressed && styles.pressed]}>
        {refreshing ? <ActivityIndicator color={color(deviceColors.green, 'accent')} />
          : <Ionicons name="sync-outline" size={23} color={color(deviceColors.green, 'accent')} />}
      </Pressable>
    </View>
  </View>;
}

const useStyles = createThemedStyles(color => ({
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: color('#f7f9f7', 'canvas'),
  },
  side: { flex: 1, minWidth: 0 },
  right: { alignItems: 'flex-end' },
  back: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  backLabel: { ...textMetrics(16, 24), flexShrink: 1, color: color(deviceColors.ink, 'ink') },
  title: {
    ...textMetrics(18, 28), flex: 2, minWidth: 0, textAlign: 'center', fontWeight: '600',
    color: color(deviceColors.ink, 'ink'),
  },
  refresh: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.65 },
}));
