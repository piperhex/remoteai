import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useChatOverlay } from './ChatOverlay';

interface Props {
  anchor: RefObject<View | null>;
  children: ReactNode;
  close: () => void;
}
const EDGE = 10;
const PANEL_GAP = 8;
const MENU_WIDTH = 184;
type Position = { left: number; top: number; width: number; maxHeight: number };

export function ChatToolsPopover({ anchor, children, close }: Props) {
  const popoverStyles = usePopoverStyles();
  useLanguage();
  const host = useChatOverlay();
  const [position, setPosition] = useState<Position>();
  useLayoutEffect(() => {
    let cancelled = false;
    host.root.current?.measureInWindow((rootX, rootY) => {
      anchor.current?.measureInWindow((x, y, anchorWidth, anchorHeight) => {
        if (cancelled) return;
        const width = Math.min(MENU_WIDTH, Math.max(0, host.size.width - EDGE * 2));
        const top = y - rootY + anchorHeight + PANEL_GAP;
        const left = Math.max(EDGE, Math.min(x - rootX + anchorWidth - width, host.size.width - width - EDGE));
        setPosition({ left, top, width, maxHeight: Math.max(0, host.size.height - top - EDGE) });
      });
    });
    return () => { cancelled = true; };
  }, [host, anchor]);
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => back.remove();
  }, [close]);
  useLayoutEffect(() => {
    if (!position) return;
    host.show(<>
      <Pressable accessibilityRole="button" accessibilityLabel={t("关闭工具菜单")}
        onPress={close} style={StyleSheet.absoluteFill} />
      <View accessibilityViewIsModal style={[popoverStyles.panel, position]}>
        <ScrollView keyboardShouldPersistTaps="always" style={popoverStyles.scroll}
          contentContainerStyle={popoverStyles.content}>{children}</ScrollView>
      </View>
    </>);
  }, [host, position, children, close]);
  useLayoutEffect(() => () => host.show(null), [host.show]);
  return null;
}

const usePopoverStyles = createThemedStyles((color) => ({
  panel: { position: 'absolute', borderRadius: 12, backgroundColor: color('#fff', 'surface'),
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 4 },
    elevation: 8 },
  scroll: { flexShrink: 1, borderRadius: 12 },
  content: { padding: 8, gap: 4 },
}));
