import { Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTurnRetry } from '../../../../shared/chat/TurnRetryContext';
import { t } from '../i18n';

export function ChatRetryButton({ turnId }: { turnId: string }) {
  const action = useTurnRetry(turnId);
  if (!action) return null;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: action.disabled }}
    disabled={action.disabled} onPress={() => { void action.retry(); }}
    style={[styles.button, action.disabled && styles.disabled]}>
    <Ionicons name="refresh-outline" size={14} color="#c96c3d" />
    <Text style={styles.label}>{action.pending ? t('正在重试…') : t('重试')}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5,
    minHeight: 44, marginTop: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#c96c3d', borderRadius: 8 },
  label: { color: '#c96c3d', fontSize: 12 },
  disabled: { opacity: 0.5 },
});
