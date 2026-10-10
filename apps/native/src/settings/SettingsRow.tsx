import { useThemeColor } from '../theme/store';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, Text, View } from 'react-native';
import { settingsColors, useStyles } from './styles';

interface SettingsRowProps {
  icon: ComponentProps<typeof Ionicons>['name'];
  color: string;
  background: string;
  label: string;
  value?: string;
  divider?: boolean;
  onPress?: () => void;
}

export function SettingsRow({ icon, color, background, label, value, divider, onPress }: SettingsRowProps) {
  const styles = useStyles();
  const themedColor = useThemeColor();
  const content = <>
    <View style={[styles.icon, { backgroundColor: themedColor(background, 'elevated') }]}>
      <Ionicons name={icon} size={22} color={color} />
    </View>
    <View style={[styles.rowContent, divider && styles.divider]}>
      <Text style={styles.label}>{label}</Text>
      {value ? <Text selectable={!onPress} style={styles.value} numberOfLines={1}>{value}</Text>
        : <View style={styles.spacer} />}
      {onPress ? <Ionicons name="chevron-forward" size={19} color={themedColor(settingsColors.muted, 'muted')} /> : null}
    </View>
  </>;
  if (!onPress) return <View style={styles.row}>{content}</View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={value ? `${label}，${value}` : label}
    onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
    {content}
  </Pressable>;
}
