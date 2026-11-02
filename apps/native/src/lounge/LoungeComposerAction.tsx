import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { textMetrics } from '../theme/text';
import { createLoungeStyles, useLoungeColor } from './theme';

export function LoungeComposerAction({ icon, label, onPress, disabled, hint, error }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void;
  disabled?: boolean; hint?: string; error?: string;
}) {
  const styles = useStyles();
  const color = useLoungeColor();
  return <View style={styles.cell}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed, disabled && styles.disabled]}>
      <View style={styles.icon}>
        <Ionicons name={icon} size={25} color={color('#456c96', 'info')} accessible={false} />
      </View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </View>;
}

const useStyles = createLoungeStyles(color => ({
  cell: { width: '33.333333%', paddingHorizontal: 6 },
  card: { flex: 1, minHeight: 96, paddingHorizontal: 6, paddingVertical: 12, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: color('#f0f4f7', 'elevated') },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: color('#deebf7', 'infoSoft') },
  label: { ...textMetrics(14, 20), alignSelf: 'stretch', textAlign: 'center',
    color: color('#46536b', 'ink'), fontWeight: '500' },
  error: { ...textMetrics(12, 18), color: color('#b43d43', 'danger'), marginTop: 6 },
  pressed: { backgroundColor: color('#e3ebf2', 'border') },
  disabled: { opacity: 0.38 },
}));
