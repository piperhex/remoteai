import { useThemeColor } from '../theme/store';
import { createThemedStyles } from '../theme/styles';
import { forwardRef, type ReactNode } from 'react';
import {  useWindowDimensions, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import DrawerLayout, { DrawerKeyboardDismissMode, DrawerLockMode, DrawerPosition, DrawerState, DrawerType,
  type DrawerLayoutMethods } from 'react-native-gesture-handler/ReanimatedDrawerLayout';

export type ChatDrawerMethods = DrawerLayoutMethods;
interface Props {
  children: ReactNode; navigation: ReactNode; enabled: boolean;
  onOpen: () => void; onClose: () => void; onMoving: () => void;
}
// Leave room to start just inside Android's system back-gesture strip.
const EDGE_WIDTH = 48;
const MIN_SWIPE_DISTANCE = 10;

/** Keep the list mounted and let the native UI thread drive both dragging and settling. */
export const ChatDrawer = forwardRef<ChatDrawerMethods, Props>(function ChatDrawer(
  { children, navigation, enabled, onOpen, onClose, onMoving }, ref,
) {
  const drawerStyles = useDrawerStyles();
  const color = useThemeColor();
  const width = Math.min(useWindowDimensions().width * 0.88, 360);
  return <GestureHandlerRootView style={drawerStyles.root}>
    <DrawerLayout ref={ref} drawerWidth={width} drawerPosition={DrawerPosition.LEFT} drawerType={DrawerType.FRONT}
      drawerBackgroundColor={color('#fff', 'surface')}
      edgeWidth={EDGE_WIDTH} minSwipeDistance={MIN_SWIPE_DISTANCE}
      drawerLockMode={enabled ? DrawerLockMode.UNLOCKED : DrawerLockMode.LOCKED_CLOSED}
      keyboardDismissMode={DrawerKeyboardDismissMode.ON_DRAG} overlayColor="rgba(6, 20, 15, 0.45)"
      drawerContainerStyle={drawerStyles.panel} onDrawerOpen={onOpen} onDrawerClose={onClose}
      onDrawerStateChanged={(state) => { if (state !== DrawerState.IDLE) onMoving(); }}
      renderNavigationView={() => <View style={drawerStyles.root}>{navigation}</View>}>
      {children}
    </DrawerLayout>
  </GestureHandlerRootView>;
});

const useDrawerStyles = createThemedStyles(() => ({
  root: { flex: 1 },
  panel: { borderTopRightRadius: 20, borderBottomRightRadius: 20, overflow: 'hidden' },
}));
