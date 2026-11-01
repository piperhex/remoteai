import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { SheetScrollView } from '../components/SheetScrollView';
import { LANGUAGE_OPTIONS, t, useLanguage, type Language } from '../i18n';
import { setLanguage } from '../i18n/preference';
import { useStyles } from './styles';

export function LanguageSheet({ onClose }: { onClose: () => void }) {
  const language = useLanguage();
  const styles = useStyles();
  const saving = useRef(false);
  const [error, setError] = useState(false);
  const choose = async (next: Language) => {
    if (saving.current) return;
    saving.current = true;
    const saved = await setLanguage(next);
    saving.current = false;
    if (saved) onClose();
    else setError(true);
  };
  return <BottomSheet visible title={t('client.settings.language')} onClose={onClose} maxWidth={400} fullWidthContent>
    <SheetScrollView>
      <View style={styles.sheetBody} accessibilityRole="radiogroup"
        accessibilityLabel={t('client.settings.language')}>
        {LANGUAGE_OPTIONS.map(option => <Pressable key={option.value} accessibilityRole="radio"
          accessibilityLabel={option.label} accessibilityState={{ checked: language === option.value }}
          style={styles.themeOption} onPress={() => void choose(option.value)}>
          <Text style={styles.detailLabel}>{option.label}</Text><View style={styles.spacer} />
          {language === option.value && <Text style={styles.detailLabel}>✓</Text>}
        </Pressable>)}
        {error && <Text accessibilityRole="alert" style={styles.error}>
          {t('client.mobile.languageChangedButCouldNotBeSavedChooseItAgain')}
        </Text>}
      </View>
    </SheetScrollView>
  </BottomSheet>;
}
