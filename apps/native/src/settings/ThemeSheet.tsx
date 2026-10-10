import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { THEME_OPTIONS, type ThemeMode } from '../../../../shared/theme/mode';
import { BottomSheet } from '../components/BottomSheet';
import { t } from '../i18n';
import { setThemeMode, useThemeMode } from '../theme/preference';
import { useStyles } from './styles';

export function ThemeSheet({ onClose }: { onClose: () => void }) {
  const mode = useThemeMode();
  const styles = useStyles();
  const [error, setError] = useState(false);
  const choose = async (next: ThemeMode) => {
    if (await setThemeMode(next)) onClose();
    else setError(true);
  };
  return <BottomSheet visible title={t('外观')} onClose={onClose} maxWidth={400}>
    <View style={styles.sheetBody} accessibilityRole="radiogroup">
      {THEME_OPTIONS.map(option => <Pressable key={option.value} accessibilityRole="radio"
        accessibilityLabel={t(option.label)} accessibilityState={{ checked: mode === option.value }}
        style={styles.themeOption} onPress={() => void choose(option.value)}>
        <Text style={styles.detailLabel}>{t(option.label)}</Text>
        <View style={styles.spacer} />
        {mode === option.value && <Text style={styles.detailLabel}>✓</Text>}
      </Pressable>)}
      {error && <Text accessibilityRole="alert" style={styles.error}>
        {t('外观已切换，但未能保存。下次打开应用后请重新选择。')}
      </Text>}
    </View>
  </BottomSheet>;
}
