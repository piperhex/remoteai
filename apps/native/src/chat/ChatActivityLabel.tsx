import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useActivitySweep } from './useActivitySweep';
import { palette, useStyles } from './styles';

type LabelProps = { icon: React.ComponentProps<typeof Ionicons>['name']; text: string };
const SWEEP_WIDTH = 80;
const SWEEP_BANDS = [80, 64, 48, 32, 16];

function Label({ icon, text, color = palette.muted, iconColor = color }: LabelProps & {
  color?: string; iconColor?: string;
}) {
  const labelStyles = useLabelStyles();
  const styles = useStyles();
  return <View style={labelStyles.row}>
    <Ionicons name={icon} size={15} color={iconColor} />
    <Text numberOfLines={2} style={[styles.subtitle, styles.fill, { color }]}>{text}</Text>
  </View>;
}

export function ChatActivityLabel({ icon, text, active, failed = false }: LabelProps & {
  active: boolean; failed?: boolean;
}) {
  const labelStyles = useLabelStyles();
  if (active) return <SweepingLabel icon={icon} text={text} />;
  return <View style={labelStyles.container}>
    <Label icon={icon} text={text} iconColor={failed ? palette.danger : undefined} />
  </View>;
}

function SweepingLabel({ icon, text }: LabelProps) {
  const labelStyles = useLabelStyles();
  const color = useThemeColor();
  const [width, setWidth] = useState(0);
  const { progress, enabled } = useActivitySweep(width > 0);
  const travel = progress.interpolate({ inputRange: [0, 1], outputRange: [-SWEEP_WIDTH, width + SWEEP_WIDTH] });
  return <View style={labelStyles.container} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
    <Label icon={icon} text={text} />
    {enabled && <View pointerEvents="none" style={StyleSheet.absoluteFill}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {SWEEP_BANDS.map((bandWidth) => {
        const translation = Animated.add(travel, (SWEEP_WIDTH - bandWidth) / 2);
        return <Animated.View key={bandWidth} style={[labelStyles.band,
          { width: bandWidth, transform: [{ translateX: translation }] }]}>
          {/* Counter-translation keeps the highlighted glyphs aligned with the unchanged base label. */}
          <Animated.View style={{ width, transform: [{ translateX: Animated.multiply(translation, -1) }] }}>
            <Label icon={icon} text={text} color={color(palette.green, 'accent')} />
          </Animated.View>
        </Animated.View>;
      })}
    </View>}
  </View>;
}

const useLabelStyles = createThemedStyles(() => ({
  container: { flex: 1, minWidth: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  // Overlapping bands soften the sweep without fading the readable base text or painting its background.
  band: { position: 'absolute', top: 0, bottom: 0, overflow: 'hidden', opacity: 0.15 },
}));
