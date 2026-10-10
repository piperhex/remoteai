import { useThemeColor } from '../theme/store';
import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { SHEET_HORIZONTAL_PADDING } from './SheetScrollView';

const AnimatedSafeAreaView = Animated.createAnimatedComponent(SafeAreaView);
const DRAG_DISMISS_DISTANCE = 80;
const DRAG_DISMISS_VELOCITY = 0.9;

export interface BottomSheetAction {
  label: string;
  onPress: () => void | Promise<void>;
  tone?: 'primary' | 'neutral' | 'danger';
  loading?: boolean;
  disabled?: boolean;
}

interface BottomSheetProps {
  visible: boolean;
  title: string;
  truncateTitle?: boolean;
  subtitle?: string;
  onClose: () => void;
  onBack?: () => void;
  children?: ReactNode;
  actions?: BottomSheetAction[];
  dismissible?: boolean;
  tall?: boolean;
  dragFromHeaderOnly?: boolean;
  fullWidthContent?: boolean;
  maxWidth?: number;
  compactHeader?: boolean;
}

export function BottomSheet({
  visible,
  title,
  truncateTitle = false,
  subtitle,
  onClose,
  onBack,
  children,
  actions = [],
  dismissible = true,
  tall = false,
  dragFromHeaderOnly = false,
  fullWidthContent = false,
  maxWidth,
  compactHeader = false,
}: BottomSheetProps) {
  const resolveThemeColor = useThemeColor();
  const styles = useStyles();
  useLanguage();
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    translateY.stopAnimation();
    translateY.setValue(0);
  }, [translateY, visible]);

  const close = () => {
    if (dismissible) onClose();
  };

  const resetDrag = useCallback(() => {
    Animated.spring(translateY, {
      toValue: 0,
      damping: 22,
      stiffness: 240,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [translateY]);

  const dragResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_event, gesture) => (
      dismissible
      && gesture.dy > 6
      && Math.abs(gesture.dy) > Math.abs(gesture.dx)
    ),
    onPanResponderGrant: () => {
      translateY.stopAnimation();
    },
    onPanResponderMove: (_event, gesture) => {
      translateY.setValue(Math.max(0, gesture.dy));
    },
    onPanResponderRelease: (_event, gesture) => {
      const draggedFarEnough = gesture.dy >= DRAG_DISMISS_DISTANCE;
      const flickedDown = gesture.dy > 12 && gesture.vy >= DRAG_DISMISS_VELOCITY;
      if (draggedFarEnough || flickedDown) {
        onClose();
        return;
      }
      resetDrag();
    },
    onPanResponderTerminate: resetDrag,
  }), [dismissible, onClose, resetDrag, translateY]);

  return <Modal
    visible={visible}
    transparent
    animationType="slide"
    statusBarTranslucent
    onRequestClose={() => { if (dismissible) (onBack ?? onClose)(); }}
  >
    {/* Measure the modal window, not the animated sheet: fractional insets can otherwise feed back into its height. */}
    <SafeAreaProvider>
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.select({ ios: 'padding', android: undefined })}
    >
      <Pressable accessible={false} style={styles.backdrop} onPress={close} />
      <AnimatedSafeAreaView
        edges={['bottom']}
        style={[
          styles.sheet,
          maxWidth !== undefined && { maxWidth, width: '100%', alignSelf: 'center' },
          tall && styles.sheetTall,
          { transform: [{ translateY }] },
        ]}
        {...(!dragFromHeaderOnly ? dragResponder.panHandlers : {})}
      >
        <View style={styles.inset} {...(dragFromHeaderOnly ? dragResponder.panHandlers : {})}>
          <View style={[styles.handle, compactHeader && styles.compactHandle]} />
          <View style={[styles.header, compactHeader && styles.compactHeader]}>
            {onBack && <Pressable accessibilityRole="button" accessibilityLabel={t("返回上一层")}
              hitSlop={8} onPress={onBack} style={styles.closeButton}>
              <Text style={styles.closeText}>‹</Text>
            </Pressable>}
            <View style={[styles.heading, compactHeader && styles.compactHeading]}>
              <Text style={[styles.title, compactHeader && styles.compactTitle]}
                numberOfLines={truncateTitle ? 1 : undefined} ellipsizeMode="tail">
                {title}</Text>
              {subtitle ? <Text style={[styles.subtitle, compactHeader && styles.compactSubtitle]}
                numberOfLines={compactHeader ? 1 : 2}>{subtitle}</Text> : null}
            </View>
            {dismissible ? <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("关闭{value1}", { value1: title })}
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            >
              <Text style={styles.closeText}>×</Text>
            </Pressable> : null}
          </View>
        </View>
        {children ? <View style={[styles.content, compactHeader && styles.compactContent,
          !fullWidthContent && styles.inset]}>{children}</View> : null}
        {actions.length ? <View style={[styles.actions, styles.inset]}>
          {actions.map((action) => {
            const tone = action.tone ?? 'neutral';
            return <Pressable
              key={action.label}
              accessibilityRole="button"
              disabled={action.disabled || action.loading}
              onPress={() => void action.onPress()}
              style={({ pressed }) => [
                styles.action,
                tone === 'primary' && styles.actionPrimary,
                tone === 'danger' && styles.actionDanger,
                pressed && styles.pressed,
                (action.disabled || action.loading) && styles.disabled,
              ]}
            >
              {action.loading
                ? <ActivityIndicator color={tone === 'neutral' ? resolveThemeColor('#173128', 'ink') : '#fff'} size="small" />
                : <Text style={[
                  styles.actionText,
                  tone === 'primary' && styles.actionTextOnColor,
                  tone === 'danger' && styles.actionTextOnColor,
                ]}>{action.label}</Text>}
            </Pressable>;
          })}
        </View> : null}
      </AnimatedSafeAreaView>
    </KeyboardAvoidingView>
    </SafeAreaProvider>
  </Modal>;
}

const useStyles = createThemedStyles((color) => ({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6, 20, 15, 0.5)' },
  sheet: {
    maxHeight: '82%',
    backgroundColor: color('#ffffff', 'surface'),
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 9,
    shadowColor: '#06140f',
    shadowOpacity: 0.24,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 24,
  },
  sheetTall: { maxHeight: '92%' },
  inset: { paddingHorizontal: SHEET_HORIZONTAL_PADDING },
  handle: { width: 44, height: 5, borderRadius: 3, alignSelf: 'center', backgroundColor: color('#d5dfd9', 'elevated'), marginBottom: 17 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  heading: { flex: 1, minWidth: 0 },
  title: { color: color('#10251d', 'ink'), fontSize: 21, lineHeight: 31, fontWeight: '800',
    includeFontPadding: true, paddingVertical: 2 },
  subtitle: { color: color('#708078', 'muted'), fontSize: 12, lineHeight: 18, marginTop: 4,
    includeFontPadding: true, paddingVertical: 2 },
  closeButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: color('#eef3f0', 'canvas'), alignItems: 'center', justifyContent: 'center' },
  closeText: { color: color('#52645b', 'ink'), fontSize: 25, lineHeight: 28, fontWeight: '400', marginTop: -2 },
  content: { marginTop: 19, flexShrink: 1 },
  compactHandle: { marginBottom: 8 },
  compactHeader: { alignItems: 'center' },
  compactHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  compactTitle: { fontSize: 18, lineHeight: 28, fontWeight: '700' },
  compactSubtitle: { flexShrink: 1, marginTop: 0, fontSize: 11 },
  compactContent: { marginTop: 8 },
  actions: { flexDirection: 'row', gap: 10, paddingTop: 16, paddingBottom: 10 },
  action: {
    flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: color('#eef3f0', 'canvas'),
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10,
  },
  actionPrimary: { backgroundColor: '#0b8065' },
  actionDanger: { backgroundColor: '#c84f47' },
  actionText: { alignSelf: 'stretch', textAlign: 'center', color: color('#173128', 'ink'), fontSize: 15,
    lineHeight: 22, includeFontPadding: true, fontWeight: '800' },
  actionTextOnColor: { color: '#ffffff' },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.55 },
}));
