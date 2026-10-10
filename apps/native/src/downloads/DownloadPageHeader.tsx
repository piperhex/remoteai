import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { colors, useStyles } from './styles';

export function DownloadPageHeader({ title, back, backLabel = t("返回上一级") }: {
  title: string; back: () => void; backLabel?: string;
}) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  return <View style={styles.navigation}>
    <Pressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={back}
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
      <Ionicons name="chevron-back" size={24} color={color(colors.ink, 'ink')} />
    </Pressable>
    <Text accessibilityRole="header" style={styles.pageTitle}>{title}</Text>
    <View style={styles.back} />
  </View>;
}
