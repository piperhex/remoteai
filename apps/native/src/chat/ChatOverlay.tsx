import { createThemedStyles } from '../theme/styles';
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

type OverlayHost = {
  root: React.RefObject<View | null>;
  size: { width: number; height: number };
  show: (content: ReactNode) => void;
};
const OverlayContext = createContext<OverlayHost | null>(null);

/** Keep popovers in the same native window so opening them preserves the keyboard. */
export function ChatOverlay({ children }: { children: ReactNode }) {
  const overlayStyles = useOverlayStyles();
  const root = useRef<View>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [content, show] = useState<ReactNode>(null);
  const host = useMemo(() => ({ root, size, show }), [size]);
  return <OverlayContext.Provider value={host}>
    <View ref={root} collapsable={false} style={overlayStyles.root}
      onLayout={({ nativeEvent: { layout } }) => setSize({ width: layout.width, height: layout.height })}>
      {children}
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>{content}</View>
    </View>
  </OverlayContext.Provider>;
}

export function useChatOverlay() {
  const host = useContext(OverlayContext);
  if (!host) throw new Error('Chat popovers require ChatOverlay');
  return host;
}

const useOverlayStyles = createThemedStyles(() => ({ root: { flex: 1 } }));
