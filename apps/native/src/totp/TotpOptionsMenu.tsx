import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { totpColors } from './pageStyles';

interface MenuOption {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  danger?: boolean;
  selected?: boolean;
}

export function TotpOptionsMenu({ title, visible, onClose, options }: {
  title: string;
  visible: boolean;
  onClose: () => void;
  options: MenuOption[];
}) {
  const resolveThemeColor = useThemeColor();
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  return <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <Pressable accessibilityLabel={t("关闭菜单")} accessibilityRole="button"
        style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.menu} accessibilityViewIsModal>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t("关闭菜单")} onPress={onClose} style={styles.close}>
            <Ionicons name="close" size={22} color={color(totpColors.muted, 'muted')} />
          </Pressable>
        </View>
        {options.map((option) => <Pressable key={option.label} accessibilityRole="button"
          accessibilityState={{ selected: option.selected }}
          style={({ pressed }) => [styles.option, pressed && styles.pressed]}
          onPress={() => { onClose(); option.onPress(); }}>
          <Ionicons name={option.icon} size={21} color={option.danger ? resolveThemeColor('#c64b43', 'danger') : resolveThemeColor(totpColors.green, 'accent')} />
          <Text style={[styles.label, option.danger && styles.danger]}>{option.label}</Text>
          {option.selected ? <Ionicons name="checkmark" size={20} color={color(totpColors.green, 'accent')} /> : null}
        </Pressable>)}
      </View>
    </View>
  </Modal>;
}

const useStyles = createThemedStyles((color) => ({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#14251e55' },
  menu: { width: '100%', maxWidth: 400, padding: 16, borderRadius: 22, backgroundColor: color('#fff', 'surface') },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  title: { flex: 1, color: color(totpColors.ink, 'ink'), fontSize: 18, fontWeight: '700' },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, padding: 10, borderRadius: 12 },
  label: { flex: 1, color: color(totpColors.ink, 'ink'), fontSize: 16 },
  danger: { color: color('#c64b43', 'danger') },
  pressed: { backgroundColor: color('#edf7f2', 'canvas') },
}));
