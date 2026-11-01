import { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { t, useLanguage } from '../i18n';
import { createThemedStyles } from '../theme/styles';
import { textMetrics } from '../theme/text';

const MENU_WIDTH = 200;
const MENU_GAP = 6;
const EDGE = 12;

export function TotpAddMenu({ headerHeight, onClose, onManualAdd, onScanAdd }: {
  headerHeight: number;
  onClose: () => void;
  onManualAdd: () => void;
  onScanAdd: () => void;
}) {
  useLanguage();
  const styles = useStyles();
  const [height, setHeight] = useState(0);
  const top = headerHeight + MENU_GAP;
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => back.remove();
  }, [onClose]);
  const options = [
    { label: t('client.app.addManually'), icon: 'create-outline', action: onManualAdd },
    { label: t('client.app.scanQrCode'), icon: 'qr-code-outline', action: onScanAdd },
  ] as const;
  // Keep the menu in the page's coordinate space, independent of Android dialog/system-bar offsets.
  return <View style={styles.overlay} onLayout={event => setHeight(event.nativeEvent.layout.height)}>
    <Pressable accessibilityRole="button" accessibilityLabel={t('client.git.closeMenu')}
      style={StyleSheet.absoluteFill} onPress={onClose} />
    {height > 0 && <ScrollView style={[styles.menu, { top, maxHeight: Math.max(0, height - top - EDGE) }]}
      keyboardShouldPersistTaps="handled"
      accessibilityViewIsModal accessibilityRole="menu" accessibilityLabel={t('client.shared.add')}>
      {options.map(option => <Pressable key={option.icon} accessibilityRole="menuitem"
        onPress={() => { onClose(); option.action(); }}
        style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
        <Ionicons name={option.icon} size={20} style={styles.icon} />
        <Text style={styles.label}>{option.label}</Text>
      </Pressable>)}
    </ScrollView>}
  </View>;
}

const useStyles = createThemedStyles(color => ({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1 },
  menu: { position: 'absolute', right: EDGE, width: MENU_WIDTH, flexGrow: 0, maxWidth: '90%',
    padding: 4, borderWidth: 1, borderRadius: 12,
    borderColor: color('#d6ece3', 'border'), backgroundColor: color('#fff', 'surface'), elevation: 8,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 4 } },
  option: { minHeight: 48, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row',
    alignItems: 'center', gap: 10, borderRadius: 8 },
  label: { ...textMetrics(16, 24), flex: 1, color: color('#101827', 'ink') },
  icon: { color: color('#008956', 'accent') },
  pressed: { backgroundColor: color('#edf7f2', 'elevated') },
}));
