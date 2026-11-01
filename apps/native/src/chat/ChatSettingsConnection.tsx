import { Pressable, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { t } from '../i18n';
import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { textMetrics } from '../theme/text';

export interface SettingsConnectionProps {
  deviceName: string;
  accountName: string;
  onDevice: () => void;
  onAccount: () => void;
}

export function ChatSettingsConnection({ deviceName, accountName, onDevice, onAccount }: SettingsConnectionProps) {
  const styles = useStyles();
  const color = useThemeColor();
  return <View style={styles.card}>
    <Pressable style={[styles.row, styles.divider]} onPress={onDevice}
      accessibilityRole="button" accessibilityLabel={t('client.chat.switchComputer')}>
      <Feather name="monitor" size={22} color={color('#17211b', 'ink')} />
      <Text style={styles.label}>{t('client.chatSettings.computer')}</Text>
      <Text style={styles.value} numberOfLines={1}>{deviceName}</Text>
      <Feather name="chevron-right" size={20} color={color('#596772', 'muted')} />
    </Pressable>
    <Pressable style={styles.row} onPress={onAccount}
      accessibilityRole="button" accessibilityLabel={t('client.chat.switchAccount')}>
      <Feather name="user" size={22} color={color('#17211b', 'ink')} />
      <Text style={styles.label}>{t('client.chatSettings.account')}</Text>
      <Text style={styles.value} numberOfLines={1}>{accountName}</Text>
      <Feather name="chevron-right" size={20} color={color('#596772', 'muted')} />
    </Pressable>
  </View>;
}

const useStyles = createThemedStyles(color => ({
  card: { borderRadius: 12, paddingHorizontal: 14, backgroundColor: color('#eef5f4', 'canvas') },
  row: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  divider: { borderBottomWidth: 1, borderBottomColor: color('#dfe8e7', 'border') },
  label: { ...textMetrics(15, 22), color: color('#17211b', 'ink'), fontWeight: '600', flexShrink: 1 },
  value: { ...textMetrics(14, 22), color: color('#596772', 'muted'), flex: 1, textAlign: 'right' },
}));
