import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Modal } from '../../components/Modal';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { DesktopResolution } from '../../../../../shared/remote-desktop/protocol';
import { t } from '../../i18n';
import { useThemeColor } from '../../theme/store';
import { useDisplaySettingsStyles as useS } from './displaySettingsStyles';

interface Anchor { x: number; y: number; width: number; height: number }
const MENU_MARGIN = 8;
const MENU_GAP = 6;
const MENU_MAX_HEIGHT = 220;

function menuPosition(anchor: Anchor, viewport: { width: number; height: number }) {
  const below = viewport.height - anchor.y - anchor.height - MENU_GAP - MENU_MARGIN;
  const above = anchor.y - MENU_GAP - MENU_MARGIN;
  const openAbove = below < Math.min(MENU_MAX_HEIGHT, above);
  const width = Math.min(anchor.width, viewport.width - MENU_MARGIN * 2);
  return {
    width, maxHeight: Math.max(0, Math.min(MENU_MAX_HEIGHT, openAbove ? above : below)),
    left: Math.max(MENU_MARGIN, Math.min(anchor.x, viewport.width - width - MENU_MARGIN)),
    ...(openAbove ? { bottom: viewport.height - anchor.y + MENU_GAP } : { top: anchor.y + anchor.height + MENU_GAP }),
  };
}

export function ResolutionDropdown({ options, current, saving, change }: {
  options: DesktopResolution[]; current?: DesktopResolution; saving: boolean;
  change: (size: DesktopResolution) => Promise<void>;
}) {
  const s = useS();
  const color = useThemeColor();
  const viewport = useWindowDimensions();
  const landscape = viewport.width > viewport.height;
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [menuViewport, setMenuViewport] = useState({ width: viewport.width, height: viewport.height });
  const trigger = useRef<View>(null);
  const list = useRef<ScrollView>(null);
  const label = current ? `${current.width} × ${current.height}` : t("client.remoteDesktop.chooseAResolution");
  // Opening an Android modal changes system-bar insets without changing orientation.
  useEffect(() => { setAnchor(null); }, [saving, landscape]);
  return <>
    <Pressable ref={trigger} disabled={saving} accessibilityRole="combobox" accessibilityLabel={t("client.remoteDesktop.resolution")}
      accessibilityValue={{ text: label }} accessibilityState={{ expanded: !!anchor && !saving, disabled: saving }}
      style={[s.resolutionSelect, saving && s.disabled]} onPress={() => {
        trigger.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }));
      }}>
      <Text style={s.text}>{label}</Text>
      <MaterialCommunityIcons name={anchor && !saving ? 'chevron-up' : 'chevron-down'}
        size={20} color={color('#aab6c9', 'faint')} />
    </Pressable>
    {anchor && !saving && <Modal transparent statusBarStyle="light" statusBarTranslucent navigationBarTranslucent
      supportedOrientations={['portrait', 'landscape-left', 'landscape-right']} onRequestClose={() => setAnchor(null)}>
      <View style={s.resolutionOverlay} onLayout={({ nativeEvent }) => setMenuViewport(nativeEvent.layout)}>
        <Pressable style={s.resolutionBackdrop} onPress={() => setAnchor(null)}
          accessibilityRole="button" accessibilityLabel={t("client.remoteDesktop.closeResolutionList")} />
        <ScrollView ref={list} style={[s.resolutionList, menuPosition(anchor, menuViewport)]}
          keyboardShouldPersistTaps="handled" indicatorStyle="white">
          {options.map(size => {
            const selected = current?.width === size.width && current?.height === size.height;
            return <Pressable key={`${size.width}x${size.height}`} accessibilityRole="radio"
              accessibilityLabel={`${size.width} × ${size.height}`} accessibilityState={{ checked: selected }}
              style={[s.resolutionOption, selected && s.selected]}
              onLayout={selected ? event => list.current?.scrollTo({ y: event.nativeEvent.layout.y, animated: false })
                : undefined}
              onPress={() => { setAnchor(null); if (!selected) void change(size); }}>
              <Text style={s.text}>{size.width} × {size.height}</Text>
              {selected && <MaterialCommunityIcons name="check" size={18} color={color('#a8c8ff', 'info')} />}
            </Pressable>;
          })}
        </ScrollView>
      </View>
    </Modal>}
  </>;
}
