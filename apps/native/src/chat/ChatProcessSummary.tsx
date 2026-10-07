import { t, useLanguage } from '../i18n';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatTurnDuration, turnElapsedMs } from '../../../desktop/src/pages/codexGui/turnTiming';
import type { WorkEntry } from './turnPresentation';
import { palette, styles } from './styles';

export function ChatProcessSummary({ entry, onOpen, onInline }: {
  entry: WorkEntry; onOpen: () => void; onInline: (turnId: string, inline: boolean) => void;
}) {
  useLanguage();
  const running = entry.turn.status === 'inProgress';
  const elapsed = entry.timed ? turnElapsedMs(entry.turn, 0) : null;
  const label = elapsed == null ? (running ? t("正在处理") : t("处理过程")) : t("用时 {value1}", { value1: formatTurnDuration(elapsed) });
  const toggle = entry.inline || ['inProgress', 'interrupted', 'failed'].includes(entry.turn.status);
  return <View style={processStyles.row}>
    <Pressable accessibilityRole="button" accessibilityLabel={t("查看处理过程，{value1} 项活动", { value1: entry.items.length })}
      style={processStyles.open} onPress={onOpen}>
      <Text style={[styles.subtitle, processStyles.label]}>
        {label}{'  '}<Ionicons name="chevron-forward" size={14} color={palette.muted} />
      </Text>
    </Pressable>
    {toggle && <Pressable accessibilityRole="button"
      accessibilityLabel={entry.inline ? t("收起处理过程") : t("展开处理过程")}
      accessibilityState={{ expanded: entry.inline }} hitSlop={6}
      style={processStyles.toggle} onPress={() => onInline(entry.turn.id, !entry.inline)}>
      <Text style={[styles.subtitle, processStyles.toggleLabel]}>{entry.inline ? t("收起") : t("展开")}</Text>
      <Ionicons name={entry.inline ? 'chevron-up' : 'chevron-down'} size={14} color={palette.muted} />
    </Pressable>}
  </View>;
}

const processStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  open: { flex: 1, minWidth: 0, minHeight: 36, justifyContent: 'center' },
  // Fill the available width: Android's fallback font can clip the last glyph at its intrinsic width.
  // Keep the chevron inline so it follows the complete label, including when the label wraps.
  label: { width: '100%', paddingVertical: 2, includeFontPadding: true },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingHorizontal: 4,
    flexShrink: 0, maxWidth: '50%' },
  toggleLabel: { flexShrink: 1, paddingVertical: 2, includeFontPadding: true },
});
