import { t, useLanguage } from '../../i18n';
import { useEffect, useSyncExternalStore } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { DesktopPointer } from '../../../../../shared/remote-desktop/input';
import { cursorPosition, mousePanelPosition, MOUSE_PANEL_SIZE, MOUSE_ICON_SIZE, type DesktopViewport, type Point }
  from '../../../../../shared/remote-desktop/geometry';
import type { MousePanelActivity } from '../../../../../shared/remote-desktop/useMousePanel';
import { useMouseButtons } from '../../../../../shared/remote-desktop/useMouseButtons';
import { useTrackpad } from './useTrackpad';
import { useLeftMouseButton } from './useLeftMouseButton';
import { useScrollPad, type ScrollPadGesture } from '../../../../../shared/remote-desktop/useScrollPad';
import type { DesktopWheel } from '../../../../../shared/remote-desktop/scrollPad';
import { useScrollButton } from './useScrollButton';
import { DesktopScrollPad } from './DesktopScrollPad';
import { desktopStyles as s } from './styles';

interface Props {
  pointer: DesktopPointer; viewport: DesktopViewport; panel: MousePanelActivity;
  wheel: DesktopWheel; horizontal: boolean; panelPosition?: Point;
}
type MousePadProps = Omit<Props, 'wheel' | 'horizontal'> & { scroll: ScrollPadGesture };
export function DesktopMouse({ visible, zoomed = false, ...props }: Props & { visible: boolean; zoomed?: boolean }) {
  useLanguage();
  const position = useSyncExternalStore(props.pointer.subscribe, props.pointer.getSnapshot);
  const scroll = useScrollPad({ ...props, enabled: visible && props.panel.expanded });
  const cursor = cursorPosition(position, props.viewport);
  const panelSize = props.panel.expanded ? MOUSE_PANEL_SIZE : MOUSE_ICON_SIZE;
  const panel = props.panelPosition ?? mousePanelPosition(cursor, zoomed ? props.viewport.stage : undefined, panelSize);
  return <>
    {props.panel.expanded && <View pointerEvents="none" accessible={false}
      style={[s.cursor, { left: cursor.x, top: cursor.y }]}>
      <Image accessible={false} source={require('../../../../../shared/remote-desktop/cursor.png')}
        resizeMode="contain" style={s.cursorImage} />
    </View>}
    {visible && <View pointerEvents="box-none" accessibilityElementsHidden={scroll.active}
      importantForAccessibility={scroll.active ? 'no-hide-descendants' : 'auto'}
      style={[s.mouseLayer, panelSize, { left: panel.x, top: panel.y, opacity: scroll.active ? 0 : 1 }]}>
      {props.panel.expanded ? <MousePad {...props} scroll={scroll} /> : <MouseIcon {...props} />}
    </View>}
    {visible && scroll.active && <DesktopScrollPad layout={scroll.layout} position={scroll.position}
      horizontal={props.horizontal} cancel={scroll.end} />}
  </>;
}
function MouseIcon({ pointer, viewport, panel }: Props) {
  useLanguage();
  const drag = useTrackpad({ pointer, viewport, panel, id: 'icon', onTap: panel.expand });
  return <View {...drag.panHandlers} accessible accessibilityRole="button" accessibilityLabel={t("展开鼠标面板")}
    onAccessibilityTap={panel.expand} accessibilityActions={[{ name: 'activate' }]}
    onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'activate') panel.expand(); }}
    style={s.mouseIcon}>
    <MaterialCommunityIcons name="mouse" size={23} color="#fff" />
  </View>;
}
function MousePad({ pointer, viewport, panel, scroll }: MousePadProps) {
  useLanguage();
  const buttons = useMouseButtons(pointer);
  const left = useLeftMouseButton({ buttons, viewport, panel });
  const wheel = useScrollButton(scroll);
  const pad = useTrackpad({ pointer, viewport, panel, id: 'pad', cancel: buttons.cancel });
  const grip = useTrackpad({ pointer, viewport, panel, id: 'grip', click: false, cancel: buttons.cancel });
  useEffect(() => { panel.hold('drag', buttons.dragging); return () => panel.hold('drag', false); },
    [buttons.dragging, panel.hold]);
  const clickLeft = () => { panel.activity(); buttons.down('left'); buttons.up('left'); };
  return <View style={s.mouse}>
    <View style={s.mouseTop}>
      <View {...left.panHandlers} accessible accessibilityRole="button" accessibilityLabel={t("鼠标左键")}
        accessibilityState={{ selected: buttons.dragging }}
        onAccessibilityTap={clickLeft} accessibilityActions={[{ name: 'activate' }]}
        onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'activate') clickLeft(); }}
        style={[s.mouseButton, (left.pressed || buttons.dragging) && s.pressed]}>
        <Text style={s.mouseText}>{buttons.dragging ? t("拖拽中") : t("左键")}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t("鼠标右键")}
        onPressIn={() => { panel.hold('right', true); buttons.down('right'); }}
        onPressOut={() => { buttons.up('right'); panel.hold('right', false); }}
        style={({ pressed }) => [s.mouseButton, s.mouseRight, pressed && s.pressed]}>
        <Text style={s.mouseText}>{t("右键")}</Text>
      </Pressable></View>
    <View {...pad.panHandlers} style={[s.pad, pad.pressed && s.pressed]} accessibilityLabel={t("滑动移动鼠标，轻点单击")}>
      <Text style={s.mouseText}>{t("滑动移动")}</Text></View>
    <View accessible accessibilityRole="button" accessibilityLabel={t("按住并拖动以滚动")}
      {...wheel.panHandlers} style={s.wheel}>
      <Ionicons name="chevron-up" size={18} color="#526684" />
      <Ionicons name="chevron-down" size={18} color="#526684" /></View>
    <View {...grip.panHandlers} style={[s.grip, grip.pressed && s.pressed]} accessibilityLabel={t("拖动鼠标面板")}>
      <Ionicons name="reorder-two" size={22} color="#526684" /></View>
  </View>;
}
