import { useThemeColor } from '../theme/store';
import { createThemedStyles } from '../theme/styles';
import { textMetrics } from '../theme/text';
import { t, useLanguage } from '../i18n';
import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Modal } from './Modal';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { SHEET_HORIZONTAL_PADDING } from './SheetScrollView';
import { useBottomSheetDrag } from './useBottomSheetDrag';
import { SheetScrollGestureContext } from './SheetScrollGesture';
import { SheetLayerContext, useSheetLayers } from './useSheetLayers';

const AnimatedSafeAreaView = Animated.createAnimatedComponent(SafeAreaView);
const SHEET_ELEVATION = 24;

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
  titleIcon?: ReactNode;
  titleAction?: ReactNode;
  truncateTitle?: boolean;
  subtitle?: string;
  onClose: () => void;
  onBack?: () => void;
  children?: ReactNode;
  /** Covers the entire modal window, including the sheet header. */
  overlay?: ReactNode;
  actions?: BottomSheetAction[];
  dismissible?: boolean;
  tall?: boolean;
  fillHeight?: boolean;
  fullscreen?: boolean;
  fullWidthContent?: boolean;
  horizontalPadding?: number;
  maxWidth?: number;
  compactHeader?: boolean;
  hideHeader?: boolean;
}

export function BottomSheet({
  visible,
  title,
  titleIcon,
  titleAction,
  truncateTitle = false,
  subtitle,
  onClose,
  onBack,
  children,
  overlay,
  actions = [],
  dismissible = true,
  tall = false,
  fillHeight = false,
  fullscreen = false,
  fullWidthContent = false,
  horizontalPadding = SHEET_HORIZONTAL_PADDING,
  maxWidth,
  compactHeader = false,
  hideHeader = false,
}: BottomSheetProps) {
  const resolveThemeColor = useThemeColor();
  const styles = useStyles();
  const insetStyle = { paddingHorizontal: horizontalPadding };
  const sheetAccessibility = {
    accessibilityElementsHidden: Boolean(overlay),
    importantForAccessibility: overlay ? 'no-hide-descendants' as const : 'auto' as const,
  };
  useLanguage();
  const layer = useSheetLayers(visible);
  const { translateY, scrollGesture, panHandlers, handleHandlers } = useBottomSheetDrag({
    visible, enabled: dismissible && !fullscreen && !overlay && !layer.covered, onClose,
  });

  const close = () => {
    if (dismissible) onClose();
  };

  const headingTitle = <Text style={[styles.title, compactHeader && styles.compactTitle,
    titleAction ? styles.actionTitle : undefined]}
    numberOfLines={truncateTitle ? 1 : undefined} ellipsizeMode="tail">{title}</Text>;

  return <Modal
    visible={visible}
    transparent
    animationType="slide"
    statusBarTranslucent
    supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}
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
        edges={fullscreen ? ['top', 'bottom', 'left', 'right'] : ['bottom']}
        pointerEvents={overlay ? 'none' : 'auto'}
        style={[
          styles.sheet,
          maxWidth !== undefined && { maxWidth, width: '100%', alignSelf: 'center' },
          tall && styles.sheetTall,
          fillHeight && { height: tall ? '92%' : '82%' },
          fullscreen && styles.sheetFullscreen,
          { transform: [{ translateY }] },
        ]}
      >
        <SheetLayerContext.Provider value={layer.register}>
        <SheetScrollGestureContext.Provider value={scrollGesture}>
        <View collapsable={false} style={[styles.gestureSurface,
          (fillHeight || fullscreen) && styles.fill]} {...panHandlers}>
        <View style={insetStyle} {...sheetAccessibility}>
          {!fullscreen && <View testID="bottom-sheet-handle" collapsable={false} {...handleHandlers}
            style={[styles.handleArea, compactHeader && styles.compactHandle]}
            accessible={dismissible} accessibilityRole="button"
            accessibilityLabel={t('client.sheet.dragToClose')} onAccessibilityTap={close}>
            <View pointerEvents="none" style={styles.handle} />
          </View>}
          {!hideHeader && <View style={[styles.header, compactHeader && styles.compactHeader,
            fullscreen && styles.fullscreenHeader]}>
            {onBack && <Pressable accessibilityRole="button" accessibilityLabel={t("client.app.goBackOneLevel")}
              hitSlop={8} onPress={onBack} style={styles.closeButton}>
              <Text style={styles.closeText}>‹</Text>
            </Pressable>}
            {titleIcon}
            <View style={[styles.heading, compactHeader && styles.compactHeading]}>
              {titleAction ? <View style={styles.titleRow}>{headingTitle}{titleAction}</View> : headingTitle}
              {subtitle ? <Text style={[styles.subtitle, compactHeader && styles.compactSubtitle]}
                numberOfLines={compactHeader ? 1 : 2}>{subtitle}</Text> : null}
            </View>
            {dismissible ? <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("client.mobile.close", { value1: title })}
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            >
              <Text style={styles.closeText}>×</Text>
            </Pressable> : null}
          </View>}
        </View>
        {children ? <View {...sheetAccessibility} style={[styles.content, compactHeader && styles.compactContent,
          (fillHeight || fullscreen) && styles.fill,
          hideHeader && styles.headerlessContent,
          !fullWidthContent && insetStyle]}>{children}</View> : null}
        {actions.length ? <View {...sheetAccessibility} style={[styles.actions, insetStyle]}>
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
        </View>
        </SheetScrollGestureContext.Provider>
        </SheetLayerContext.Provider>
      </AnimatedSafeAreaView>
      {overlay ? <View pointerEvents="box-none" style={styles.overlay}>{overlay}</View> : null}
    </KeyboardAvoidingView>
    </SafeAreaProvider>
  </Modal>;
}

const useStyles = createThemedStyles((color) => ({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6, 20, 15, 0.5)' },
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1, elevation: SHEET_ELEVATION + 1 },
  sheet: {
    maxHeight: '82%',
    backgroundColor: color('#ffffff', 'surface'),
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    shadowColor: '#06140f',
    shadowOpacity: 0.24,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: SHEET_ELEVATION,
  },
  sheetTall: { maxHeight: '92%' },
  sheetFullscreen: { height: '100%', maxHeight: '100%', borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  fullscreenHeader: { paddingTop: 8 },
  fill: { flex: 1, minHeight: 0 },
  gestureSurface: { flexShrink: 1 },
  handleArea: { minHeight: 32, paddingTop: 9, paddingBottom: 17, alignItems: 'center' },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: color('#d5dfd9', 'elevated') },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  heading: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionTitle: { flexShrink: 1 },
  title: { ...textMetrics(21, 31), color: color('#10251d', 'ink'), fontWeight: '800' },
  subtitle: { ...textMetrics(12, 18), color: color('#708078', 'muted'), marginTop: 4 },
  closeButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: color('#eef3f0', 'canvas'), alignItems: 'center', justifyContent: 'center' },
  closeText: { color: color('#52645b', 'ink'), fontSize: 25, lineHeight: 28, fontWeight: '400', marginTop: -2 },
  content: { marginTop: 19, flexShrink: 1 },
  compactHandle: { paddingBottom: 8 },
  compactHeader: { alignItems: 'center' },
  compactHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  compactTitle: { ...textMetrics(18, 28), fontWeight: '700' },
  compactSubtitle: { ...textMetrics(11, 18), flexShrink: 1, marginTop: 0 },
  compactContent: { marginTop: 8 },
  headerlessContent: { marginTop: 0 },
  actions: { flexDirection: 'row', gap: 10, paddingTop: 16, paddingBottom: 10 },
  action: {
    flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: color('#eef3f0', 'canvas'),
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10,
  },
  actionPrimary: { backgroundColor: '#0b8065' },
  actionDanger: { backgroundColor: '#c84f47' },
  actionText: { ...textMetrics(15, 22), alignSelf: 'stretch', textAlign: 'center',
    color: color('#173128', 'ink'), fontWeight: '800' },
  actionTextOnColor: { color: '#ffffff' },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.55 },
}));
