import { displayError } from '../i18n/index';
import { createThemedStyles } from '../theme/styles';
import { textMetrics } from '../theme/text';
import { t, useLanguage } from '../i18n';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useImageViewer } from '../../../../shared/chat/useImageViewer';
import { useImageOrientation } from './useImageOrientation';
import { useImageGestures } from './useImageGestures';
import { useSaveImage } from './useSaveImage';
import type { PreviewImageLoader } from '../../../../shared/remote-chat/previewProgress';
import { PreviewTransferProgress } from './PreviewTransferProgress';
import { ImageAiToolbar } from './ImageAiToolbar';

interface Props {
  thumbnail?: string; description: string; load: PreviewImageLoader; close: () => void;
  save?: (url: string) => Promise<void>;
}

export function ImageViewer({ thumbnail, description, load, close, save }: Props) {
  const styles = useStyles();
  useLanguage();
  const image = useImageViewer(load);
  const orientation = useImageOrientation();
  const { gesture, animatedStyle } = useImageGestures(close, orientation.displayed);
  const saving = useSaveImage({ load: image.loadOriginal, save });
  const message = saving.message || orientation.error;
  const source = image.url ?? thumbnail;
  const originalLabel = t(image.error ? 'client.mobile.reloadOriginalImage' : 'client.chat.viewOriginal');
  return <Modal visible animationType="fade" onRequestClose={close} statusBarTranslucent
    navigationBarTranslucent supportedOrientations={['portrait', 'portrait-upside-down',
      'landscape-left', 'landscape-right']}>
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.overlay}>
        <GestureDetector gesture={gesture}>
          <View style={styles.stage} collapsable={false} onAccessibilityEscape={close}>
            {source && <Animated.Image source={{ uri: source }} accessibilityLabel={description}
              accessibilityHint={t("client.mobile.tapToClosePinchToZoom")} accessibilityActions={[{ name: 'activate', label: t("client.mobile.closePreview") }]}
              onAccessibilityAction={close} resizeMode="contain" onError={image.fail}
              fadeDuration={0} style={[styles.image, animatedStyle]} />}
          </View>
        </GestureDetector>
        <KeyboardAvoidingView pointerEvents="box-none" style={styles.controls}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <SafeAreaView pointerEvents="box-none" edges={['bottom', 'left', 'right']}>
          <View pointerEvents="box-none" style={styles.footer}>
            <View pointerEvents="box-none" style={styles.notices}>
              {!!message && <Text pointerEvents="none" accessibilityLiveRegion="polite"
                style={styles.status}>{displayError(message)}</Text>}
              {image.loading && <PreviewTransferProgress progress={image.progress} dark label={t("client.shared.loadingFullImage")} />}
              {image.error && <View style={styles.error}>
                <Text style={styles.status}>{t("client.shared.couldNotLoadFullImage")}</Text>
              </View>}
            </View>
            {orientation.suggested && <Pressable accessibilityRole="button" accessibilityLabel={t("client.mobile.matchPhoneOrientation")}
              disabled={orientation.rotating} onPress={orientation.rotate} style={styles.rotate}>
              <MaterialCommunityIcons name="screen-rotation" size={28} color="#fff" />
            </Pressable>}
            <ImageAiToolbar load={image.loadOriginal} close={close} />
          </View>
        </SafeAreaView>
        </KeyboardAvoidingView>
        <SafeAreaView pointerEvents="box-none" edges={['top', 'left', 'right']} style={styles.header}>
          <View pointerEvents="box-none" style={styles.headerActions}>
            {!image.url && !image.loading && <Pressable accessibilityRole="button"
              accessibilityLabel={originalLabel} onPress={image.request} style={styles.original}>
              <MaterialCommunityIcons name="image-outline" size={20} color="#fff" />
              <Text style={styles.originalLabel}>{originalLabel}</Text>
            </Pressable>}
            <Pressable accessibilityRole="button" accessibilityLabel={t("client.mobile.saveImageToPhotos")}
              accessibilityState={{ disabled: image.loading || saving.saving, busy: saving.saving }}
              disabled={image.loading || saving.saving} onPress={saving.save}
              style={[styles.save, (image.loading || saving.saving) && styles.disabled]}>
              {saving.saving ? <ActivityIndicator color="#fff" />
                : <MaterialCommunityIcons name="download" size={26} color="#fff" />}
            </Pressable>
          </View>
        </SafeAreaView>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  </Modal>;
}

const useStyles = createThemedStyles((color) => ({
  overlay: { flex: 1, backgroundColor: '#000' },
  stage: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  controls: { flex: 1, justifyContent: 'flex-end' },
  header: { position: 'absolute', top: 0, left: 0, right: 0 },
  headerActions: { flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 12, paddingTop: 12 },
  original: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, maxWidth: 400,
    minHeight: 48, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 24, backgroundColor: '#484848' },
  originalLabel: { ...textMetrics(14, 20), color: '#fff', flexShrink: 1 },
  footer: { paddingHorizontal: 12, paddingBottom: 12, paddingTop: 12 },
  rotate: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  save: { width: 48, height: 48, flexShrink: 0, marginLeft: 'auto', borderRadius: 24, backgroundColor: '#484848',
    alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  notices: { alignItems: 'center', gap: 8 },
  status: { color: color('#ddd', 'faint'), fontSize: 14, textAlign: 'center', maxWidth: 400 },
  error: { maxWidth: 400, alignItems: 'center', backgroundColor: '#222', borderRadius: 12, padding: 8 },
}));
