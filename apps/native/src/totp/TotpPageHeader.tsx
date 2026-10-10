import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, TextInput, View } from 'react-native';
import { usePageStyles as useStyles, totpColors as colors } from './pageStyles';

export function TotpPageHeader({ onManualAdd, onScanAdd }: {
  onManualAdd: () => void;
  onScanAdd: () => void;
}) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  return <View style={styles.header}>
    <View style={styles.heading}>
      <View style={styles.illustration} pointerEvents="none" accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <View style={styles.glow} />
        <View style={styles.flourish} />
        <Ionicons name="shield" size={74} color={color("#43b98f", 'accent')} />
        <Ionicons name="lock-closed" size={26} color="#fff" style={styles.lock} />
      </View>
      <Text style={styles.title}>{t("2FA 验证码")}</Text>
      <Text style={styles.subtitle}>{t("下拉同步云端密钥，点击验证码即可复制")}</Text>
    </View>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" onPress={onManualAdd}
        style={({ pressed }) => [styles.addButton, styles.manualButton, pressed && styles.pressed]}>
        <Ionicons name="add" size={25} color={color(colors.green, 'accent')} />
        <Text style={styles.manualText}>{t("手动添加")}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onScanAdd}
        style={({ pressed }) => [styles.addButton, styles.scanButton, pressed && styles.pressed]}>
        <Ionicons name="qr-code-outline" size={22} color="#fff" />
        <Text style={styles.scanText}>{t("扫码添加")}</Text>
      </Pressable>
    </View>
  </View>;
}

export function TotpSearchBar({ query, onQueryChange, onSort, sorted }: {
  query: string;
  onQueryChange: (query: string) => void;
  onSort: () => void;
  sorted: boolean;
}) {
  const resolveThemeColor = useThemeColor();
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  return <View style={styles.searchRow}>
    <View style={styles.searchBox}>
      <Ionicons name="search-outline" size={21} color={color(colors.muted, 'muted')} />
      <TextInput accessibilityLabel={t("搜索服务名称或账号")} placeholder={t("搜索服务名称或账号")}
        placeholderTextColor={color("#a1a8b3", 'muted')} style={styles.searchInput} value={query} onChangeText={onQueryChange}
        autoCorrect={false} autoCapitalize="none" returnKeyType="search" />
      {query ? <Pressable accessibilityRole="button" accessibilityLabel={t("清空搜索")} hitSlop={8}
        style={styles.clearSearch} onPress={() => onQueryChange('')}>
        <Ionicons name="close-circle" size={18} color={color(colors.muted, 'muted')} />
      </Pressable> : null}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={t("验证码排序")} onPress={onSort}
      style={({ pressed }) => [styles.sortButton, sorted && styles.sortActive, pressed && styles.pressed]}>
      <Ionicons name="filter-outline" size={23} color={sorted ? resolveThemeColor(colors.green, 'accent') : resolveThemeColor('#4b5360', 'ink')} />
    </Pressable>
  </View>;
}
