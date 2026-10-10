import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { useChatOverlay } from './ChatOverlay';

interface Props {
  anchor: RefObject<View | null>;
  anchorHeight: number;
  wide?: boolean;
  children: ReactNode;
  close: () => void;
}
const EDGE = 10;
const PANEL_GAP = 8;
const MENU_WIDTH = 264;
const MAX_PANEL_WIDTH = 400;
const MAX_PANEL_HEIGHT = 340;

export function ComposerPopover({ anchor, anchorHeight, wide = false, children, close }: Props) {
  const popoverStyles = usePopoverStyles();
  useLanguage();
  const host = useChatOverlay();
  const [position, setPosition] = useState<{ left: number; bottom: number; height: number }>();
  useLayoutEffect(() => {
    let cancelled = false;
    host.root.current?.measureInWindow((rootX, rootY) => {
      anchor.current?.measureInWindow((x, y) => {
        if (cancelled) return;
        setPosition({ left: wide ? EDGE : Math.max(EDGE, x - rootX),
          bottom: Math.max(EDGE, host.size.height - (y - rootY) + PANEL_GAP),
          height: Math.max(0, Math.min(MAX_PANEL_HEIGHT, y - rootY - EDGE - PANEL_GAP)) });
      });
    });
    return () => { cancelled = true; };
  }, [host, anchor, anchorHeight, wide]);
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => back.remove();
  }, [close]);
  useLayoutEffect(() => {
    if (!position) return;
    const width = Math.min(wide ? MAX_PANEL_WIDTH : MENU_WIDTH, host.size.width - EDGE * 2);
    host.show(<>
      <Pressable accessibilityRole="button" accessibilityLabel={t("关闭添加菜单")}
        onPress={close} style={StyleSheet.absoluteFill} />
      <View style={[popoverStyles.panel, { width, maxHeight: position.height, bottom: position.bottom,
        left: Math.min(position.left, host.size.width - width - EDGE) }]}>{children}</View>
    </>);
  }, [host, position, wide, children, close]);
  useLayoutEffect(() => () => host.show(null), [host.show]);
  return null;
}

const usePopoverStyles = createThemedStyles((color) => ({
  panel: { position: 'absolute', borderRadius: 26, backgroundColor: color('#fff', 'surface'), padding: 10,
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 20, shadowOffset: { width: 0, height: 5 },
    elevation: 8, overflow: 'hidden' },
}));
