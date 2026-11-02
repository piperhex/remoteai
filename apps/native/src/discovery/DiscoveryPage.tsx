import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { discoveryEntries, type DiscoveryPage as DiscoveryDestination } from '../../../../shared/navigation/discovery';
import { t, useLanguage } from '../i18n';
import { useThemeColor } from '../theme/store';
import { createThemedStyles } from '../theme/styles';
import { textMetrics } from '../theme/text';
import { DownloadCountIcon } from '../downloads/DownloadCountIcon';
import { LoungeUnread } from '../lounge/LoungeMessage';

const entryIcons = {
  lounge: 'cafe-outline',
  devices: 'server-outline',
  ssh: 'terminal-outline',
  'port-mappings': 'swap-horizontal-outline',
  totp: 'shield-checkmark-outline',
  downloads: 'download-outline',
  'token-summary': 'bar-chart-outline',
} as const;

export function DiscoveryPage({ owner, loungeUnread = 0, onOpen }: {
  owner?: string;
  loungeUnread?: number;
  onOpen: (page: DiscoveryDestination) => void;
}) {
  useLanguage();
  const styles = useStyles();
  const color = useThemeColor();
  return <View style={styles.page}>
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.title}>{t('client.discovery.title')}</Text>
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      {discoveryEntries.filter(entry => entry.page !== 'downloads' || Platform.OS === 'android')
        .map(entry => <Pressable key={entry.page} accessibilityRole="button"
        onPress={() => onOpen(entry.page)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        {entry.page === 'downloads'
          ? <DownloadCountIcon owner={owner}>
            <Ionicons name="download-outline" size={25} color={color('#07b775', 'accent')} />
          </DownloadCountIcon>
          : <LoungeUnread count={entry.page === 'lounge' ? loungeUnread : 0}>
            <Ionicons name={entryIcons[entry.page]} size={25}
              color={entry.page === 'devices' ? color('#3984db', 'info') : color('#07b775', 'accent')} />
          </LoungeUnread>}
        <Text style={styles.label}>{t(entry.label)}</Text>
        <Ionicons name="chevron-forward" size={20} color={color('#b2b2b2', 'muted')} />
      </Pressable>)}
    </ScrollView>
  </View>;
}

export function DiscoveryBackButton({ onBack }: { onBack: () => void }) {
  useLanguage();
  const styles = useStyles();
  const color = useThemeColor();
  return <Pressable accessibilityRole="button" accessibilityLabel={t('client.discovery.back')}
    onPress={onBack} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
    <Ionicons name="chevron-back" size={22} color={color('#222', 'ink')} />
    <Text style={styles.backLabel}>{t('client.discovery.title')}</Text>
  </Pressable>;
}

const useStyles = createThemedStyles(color => ({
  page: { flex: 1, backgroundColor: color('#ededed', 'canvas') },
  header: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 6 },
  title: { ...textMetrics(18, 28), fontWeight: '600', color: color('#181818', 'ink') },
  content: { paddingBottom: 20 },
  row: {
    flexDirection: 'row', alignItems: 'center', minHeight: 58, gap: 18,
    paddingHorizontal: 20, paddingVertical: 16, marginBottom: 10,
    backgroundColor: color('#fff', 'surface'),
  },
  label: { ...textMetrics(17, 26), flex: 1, color: color('#181818', 'ink') },
  pressed: { opacity: 0.65 },
  back: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', minHeight: 48, paddingHorizontal: 16 },
  backLabel: { ...textMetrics(16, 24), flexShrink: 1, color: color('#222', 'ink'), marginLeft: 4 },
}));
