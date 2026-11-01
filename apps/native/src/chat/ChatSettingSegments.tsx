import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import type { SettingField, SettingOption } from '../../../../shared/remote-chat/settingsMenu';
import { settingSegmentColor } from '../../../../shared/remote-chat/settingSegments';
import { SETTING_SHORT_LABELS, settingShortLabel } from '../../../../shared/remote-chat/settingsPresentation';
import { displayText, useLanguage } from '../i18n';
import { createThemedStyles } from '../theme/styles';
import { textMetrics } from '../theme/text';
import { palette } from './styles';
import { useSettingSegmentDrag } from './useSettingSegmentDrag';

interface Props {
  field: SettingField;
  label: string;
  value: string;
  options: SettingOption[];
  onChange: (value: string) => void;
}

export function ChatSettingSegments({ field, label, value, options, onChange }: Props) {
  const styles = useStyles();
  const language = useLanguage();
  const { width, fontScale } = useWindowDimensions();
  const stacked = (language !== 'zh' && language !== 'ja') || width / fontScale < 330;
  const { track, preview, panHandlers } = useSettingSegmentDrag(options.length, index => {
    const option = options[index];
    if (option) onChange(option.value);
  });
  const selected = options.findIndex(option => option.value === value);
  const active = preview ?? selected;
  const accent = settingSegmentColor(active, options.length);
  if (!options.length) return null;
  return <View style={[styles.row, stacked && styles.stacked]}>
    <Text style={[styles.label, stacked && styles.stackedLabel]}>{displayText(SETTING_SHORT_LABELS[field])}</Text>
    <View style={[styles.rail, stacked && styles.stackedRail]}
      accessibilityRole="radiogroup" accessibilityLabel={label}>
      <View ref={track} collapsable={false} style={styles.track} {...panHandlers}>
        {active >= 0 && <View pointerEvents="none" style={[styles.thumb, {
          left: `${active / options.length * 100}%`, width: `${100 / options.length}%`, backgroundColor: accent,
        }]} />}
        {options.map((option, index) => <Pressable key={option.value} accessibilityRole="radio"
          accessibilityLabel={displayText(option.label)} accessibilityState={{ checked: selected === index }}
          accessibilityHint={option.description ? displayText(option.description) : undefined}
          style={styles.option} onPress={() => onChange(option.value)}>
          {index > 0 && index !== active && index - 1 !== active && <View style={styles.separator} />}
          <Text style={[styles.optionText, active === index && styles.selectedText]}>
            {displayText(settingShortLabel(field, option))}</Text>
        </Pressable>)}
      </View>
    </View>
  </View>;
}

const useStyles = createThemedStyles(color => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stacked: { flexDirection: 'column', alignItems: 'stretch', gap: 6 },
  stackedLabel: { width: 'auto' },
  stackedRail: { flex: 0 },
  label: { width: 34, flexShrink: 0, ...textMetrics(15, 22), color: color(palette.ink, 'ink'), fontWeight: '600' },
  rail: { flex: 1, minWidth: 0, padding: 2, borderRadius: 11, backgroundColor: color('#eef5f4', 'canvas') },
  track: { flexDirection: 'row', position: 'relative' },
  thumb: { position: 'absolute', top: 0, bottom: 0, borderRadius: 9 },
  option: { flex: 1, minWidth: 0, minHeight: 42, paddingHorizontal: 2, paddingVertical: 4,
    alignItems: 'center', justifyContent: 'center' },
  separator: { position: 'absolute', left: 0, top: '22%', bottom: '22%', width: 1,
    backgroundColor: color('#dfe8e7', 'border') },
  optionText: { ...textMetrics(13, 20), textAlign: 'center', color: color('#596772', 'muted') },
  selectedText: { color: '#fff' },
}));
