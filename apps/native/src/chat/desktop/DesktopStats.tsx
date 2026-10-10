import { createThemedStyles } from '../../theme/styles';
import { useThemeColor } from '../../theme/store';
import { t, useLanguage } from '../../i18n';
import { Platform, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DesktopStats as Stats } from '../../../../../shared/remote-desktop/protocol';
import { desktopStatsLines } from '../../../../../shared/remote-desktop/stats';

export function DesktopStats({ stats, close }: { stats: Stats; close: () => void }) {
  const s = useS();
  const color = useThemeColor();
  useLanguage();
  return <View style={s.panel} pointerEvents="box-none">
    <View style={s.content} pointerEvents="none" collapsable={false}><Text style={s.text} accessibilityLabel={t("连接状态")}>
      {desktopStatsLines(stats, t).join('\n')}</Text></View>
    <Pressable accessibilityRole="button" accessibilityLabel={t("关闭连接状态")} onPress={close} style={s.close}>
      <Ionicons name="close" size={18} color={color("#cbd5e1", 'faint')} />
    </Pressable>
  </View>;
}
const useS = createThemedStyles((color) => ({
  panel: { position: 'absolute', left: 0, top: 10, flexDirection: 'row', alignItems: 'flex-start', maxWidth: 240 },
  content: { flexShrink: 1, borderRadius: 6, backgroundColor: '#080b1273' },
  text: { padding: 8, color: color('#cbd5e1', 'faint'), fontSize: 12, lineHeight: 19,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontVariant: ['tabular-nums'] },
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
}));
