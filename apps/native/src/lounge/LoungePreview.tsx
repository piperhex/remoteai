import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Modal } from '../components/Modal';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useImageGestures } from '../chat/useImageGestures';
import { t } from '../i18n';
import { useLoungeStyles } from './styles';

export function LoungePreview({ uri, close }: { uri: string; close: () => void }) {
  const styles = useLoungeStyles();
  const { width, height } = useWindowDimensions();
  const { gesture, animatedStyle } = useImageGestures(close, `${uri}:${width}:${height}`);
  return <Modal animationType="fade" onRequestClose={close}>
    <GestureHandlerRootView style={styles.page}><SafeAreaView style={styles.page}>
      <Pressable accessibilityRole="button" style={styles.iconButton} onPress={close}>
        <Text style={styles.link}>{t('client.lounge.backToChat')}</Text></Pressable>
      <GestureDetector gesture={gesture}>
        <View style={previewStyles.stage} collapsable={false} onAccessibilityEscape={close}>
          <Animated.Image source={{ uri }} accessibilityLabel={t('client.lounge.image')}
            accessibilityHint={t('client.mobile.tapToClosePinchToZoom')}
            accessibilityActions={[{ name: 'activate', label: t('client.mobile.closePreview') }]}
            onAccessibilityAction={close} resizeMode="contain" fadeDuration={0}
            style={[previewStyles.image, animatedStyle]} />
        </View>
      </GestureDetector>
    </SafeAreaView></GestureHandlerRootView>
  </Modal>;
}

const previewStyles = StyleSheet.create({
  stage: { flex: 1, overflow: 'hidden', backgroundColor: '#000' },
  image: { width: '100%', height: '100%' },
});
