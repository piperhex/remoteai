import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { Pressable, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { palette } from './styles';

export function ComposerGoal({ disabled, remove }: { disabled: boolean; remove: () => void }) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  return <View style={styles.chip} accessibilityLabel={t("目标模式")}>
    <Feather name="target" size={14} color={color(palette.ink, 'ink')} />
    <Text style={styles.text}>{t("目标")}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={t("移除目标")} disabled={disabled}
      accessibilityState={{ disabled }} hitSlop={6} onPress={remove}
      style={[styles.remove, disabled && { opacity: 0.4 }]}>
      <Feather name="x" size={14} color={color(palette.ink, 'ink')} />
    </Pressable>
  </View>;
}

const useStyles = createThemedStyles((color) => ({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0,
    borderWidth: 1, borderColor: color(palette.border, 'border'), borderRadius: 999, paddingLeft: 8, backgroundColor: color('#f5f5f5', 'canvas') },
  text: { color: color(palette.ink, 'ink'), fontSize: 12 },
  remove: { padding: 7 },
}));
