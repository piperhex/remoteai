import { useThemeColor } from '../../theme/store';
import { t, useLanguage } from '../../i18n';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SCROLL_PAD_SIZE } from '../../../../../shared/remote-desktop/scrollPad';
import type { ScrollPadProps } from '../../../../../shared/remote-desktop/useScrollPad';
import { useScrollPadStyles as useS } from './scrollPadStyles';

export function DesktopScrollPad({ layout, position, horizontal, cancel }: ScrollPadProps) {
  const s = useS();
  const color = useThemeColor();
  useLanguage();
  const scale = layout.size / SCROLL_PAD_SIZE;
  const arrows = [
    { name: 'chevron-up', x: .5, y: .15 }, { name: 'chevron-down', x: .5, y: .85 },
    { name: 'chevron-back', x: .15, y: .5 }, { name: 'chevron-forward', x: .85, y: .5 },
  ] as const;
  return <View style={s.layer} pointerEvents="box-only" onTouchStart={cancel}>
    <View style={[s.pad, { left: layout.x, top: layout.y, width: layout.size, height: layout.size }]}
      accessibilityLabel={t("十字滚动滑块")}>
      <View pointerEvents="none" style={[s.cross, s.vertical]} />
      <View pointerEvents="none" style={[s.cross, s.horizontal]} />
      <View pointerEvents="none" style={s.center} />
      {arrows.map(arrow => <View key={arrow.name} pointerEvents="none" style={[s.arrow,
        { left: layout.size * arrow.x - 10, top: layout.size * arrow.y - 10,
          opacity: arrow.y === .5 && !horizontal ? .3 : 1 }]}>
        <Ionicons name={arrow.name} size={20} color={color("#dce3ec", 'faint')} /></View>)}
      <View pointerEvents="none" style={[s.knob, {
        width: layout.size * .27, height: layout.size * .27,
        left: layout.size * .365 + position.x * scale, top: layout.size * .365 + position.y * scale,
      }]} />
    </View>
    {!horizontal && <View pointerEvents="none" style={s.hint}>
      <Text style={s.hintText}>{t("更新远程电脑上的应用后，即可左右滚动。")}</Text></View>}
  </View>;
}
