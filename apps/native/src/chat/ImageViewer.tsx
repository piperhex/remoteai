import { t, useLanguage } from '../i18n';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
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

interface Props {
  thumbnail?: string; description: string; load: PreviewImageLoader; close: () => void;
  save?: (url: string) => Promise<void>;
}

export function ImageViewer({ thumbnail, description, load, close, save }: Props) {
  useLanguage();
  const image = useImageViewer(load);
  const orientation = useImageOrientation();
  const { gesture, animatedStyle } = useImageGestures(close, orientation.displayed);
  const saving = useSaveImage({ load: image.loadOriginal, save });
  const message = saving.message || orientation.error;
  const source = image.url ?? thumbnail;
  return <Modal visible animationType="fade" onRequestClose={close} statusBarTranslucent
    navigationBarTranslucent supportedOrientations={['portrait', 'portrait-upside-down',
      'landscape-left', 'landscape-right']}>
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.overlay}>
        <GestureDetector gesture={gesture}>
          <View style={styles.stage} collapsable={false} onAccessibilityEscape={close}>
            {source && <Animated.Image source={{ uri: source }} accessibilityLabel={description}
              accessibilityHint={t("轻点关闭，双指缩放")} accessibilityActions={[{ name: 'activate', label: t("关闭预览") }]}
              onAccessibilityAction={close} resizeMode="contain" onError={image.fail}
              fadeDuration={0} style={[styles.image, animatedStyle]} />}
          </View>
        </GestureDetector>
        <SafeAreaView pointerEvents="box-none" style={styles.controls}>
          <View pointerEvents="box-none" style={styles.footer}>
            <View pointerEvents="box-none" style={styles.actions}>
              {!image.url && !image.loading && <Pressable accessibilityRole="button" onPress={image.request}
                accessibilityLabel={t(image.error ? "重新加载原图" : "查看原图")}
                style={styles.original}><Text style={styles.status}>
                  {t(image.error ? "重新加载原图" : "查看原图")}</Text></Pressable>}
              {orientation.suggested && <Pressable accessibilityRole="button" accessibilityLabel={t("转到手机当前方向")}
                disabled={orientation.rotating} onPress={orientation.rotate} style={styles.rotate}>
                <MaterialCommunityIcons name="screen-rotation" size={28} color="#fff" />
              </Pressable>}
              <Pressable accessibilityRole="button" accessibilityLabel={t("下载图片到相册")}
                accessibilityState={{ disabled: image.loading || saving.saving, busy: saving.saving }}
                disabled={image.loading || saving.saving} onPress={saving.save}
                style={[styles.save, (image.loading || saving.saving) && styles.disabled]}>
                {saving.saving ? <ActivityIndicator color="#fff" />
                  : <MaterialCommunityIcons name="download" size={30} color="#fff" />}
              </Pressable>
            </View>
            <View pointerEvents="box-none" style={styles.notices}>
              {!!message && <Text pointerEvents="none" accessibilityLiveRegion="polite"
                style={styles.status}>{message}</Text>}
              {image.loading && <PreviewTransferProgress progress={image.progress} dark label={t("正在加载原图…")} />}
              {image.error && <View style={styles.error}>
                <Text style={styles.status}>{t("原图加载失败")}</Text>
              </View>}
            </View>
          </View>
        </SafeAreaView>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#000' },
  stage: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  controls: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  footer: { paddingHorizontal: 24, paddingBottom: 24, paddingTop: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 56 },
  rotate: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  original: { minHeight: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: '#484848',
    justifyContent: 'center' },
  save: { marginLeft: 'auto', width: 56, height: 56, borderRadius: 28, backgroundColor: '#484848',
    alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  notices: { position: 'absolute', bottom: 96, left: 16, right: 16, alignItems: 'center', gap: 8 },
  status: { color: '#ddd', fontSize: 14, textAlign: 'center', maxWidth: 400 },
  error: { maxWidth: 400, alignItems: 'center', backgroundColor: '#222', borderRadius: 12, padding: 8 },
});
