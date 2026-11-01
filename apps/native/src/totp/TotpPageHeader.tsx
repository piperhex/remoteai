import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useState } from 'react';
import { createThemedStyles } from '../theme/styles';
import { textMetrics } from '../theme/text';
import { usePageStyles as useStyles, totpColors as colors } from './pageStyles';

export function TotpPageHeader({ onBack, onAdd, expanded }: {
  onBack: () => void;
  onAdd: () => void;
  expanded: boolean;
}) {
  const styles = useHeaderStyles();
  const color = useThemeColor();
  useLanguage();
  const [sideWidth, setSideWidth] = useState(64);
  return <View style={styles.header}>
    <Pressable accessibilityRole="button" accessibilityLabel={t('client.discovery.back')} onPress={onBack}
      style={({ pressed }) => [styles.back, { width: sideWidth }, pressed && styles.pressed]}>
      <Ionicons name="chevron-back" size={22} color={color(colors.ink, 'ink')} />
    </Pressable>
    <Text accessibilityRole="header" style={styles.title}>{t('client.app.2faCodes')}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={t('client.shared.add')}
      accessibilityState={{ expanded }} onPress={onAdd}
      onLayout={event => setSideWidth(event.nativeEvent.layout.width)}
      style={({ pressed }) => [styles.add, pressed && styles.pressed]}>
      <Ionicons name="add" size={20} color={color(colors.green, 'accent')} />
      <Text style={styles.addText}>{t('client.shared.add')}</Text>
    </Pressable>
  </View>;
}

const useHeaderStyles = createThemedStyles(color => ({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, gap: 4 },
  back: { minHeight: 44, justifyContent: 'center', alignItems: 'flex-start' },
  title: { ...textMetrics(18, 28), flex: 1, textAlign: 'center', fontWeight: '600', color: color(colors.ink, 'ink') },
  add: { minHeight: 44, maxWidth: '32%', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'flex-end', gap: 2 },
  addText: { ...textMetrics(16, 24), flexShrink: 1, fontWeight: '600', color: color(colors.green, 'accent') },
  pressed: { opacity: 0.65 },
}));

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
      <TextInput accessibilityLabel={t("client.app.searchServicesOrAccounts")} placeholder={t("client.app.searchServicesOrAccounts")}
        placeholderTextColor={color("#a1a8b3", 'muted')} style={styles.searchInput} value={query} onChangeText={onQueryChange}
        autoCorrect={false} autoCapitalize="none" returnKeyType="search" />
      {query ? <Pressable accessibilityRole="button" accessibilityLabel={t("client.projectBrowser.clearSearch")} hitSlop={8}
        style={styles.clearSearch} onPress={() => onQueryChange('')}>
        <Ionicons name="close-circle" size={18} color={color(colors.muted, 'muted')} />
      </Pressable> : null}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={t("client.app.sortCodes")} onPress={onSort}
      style={({ pressed }) => [styles.sortButton, sorted && styles.sortActive, pressed && styles.pressed]}>
      <Ionicons name="filter-outline" size={23} color={sorted ? resolveThemeColor(colors.green, 'accent') : resolveThemeColor('#4b5360', 'ink')} />
    </Pressable>
  </View>;
}
