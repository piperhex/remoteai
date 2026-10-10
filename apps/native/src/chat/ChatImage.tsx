import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { createContext, useContext } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useChatImage, type ImagePreviewOptions } from '../../../../shared/remote-chat/client/useChatImage';
import { palette, useStyles } from './styles';
import { useChatImagePreview } from './ChatImagePreview';

export const ChatImageContext = createContext<ImagePreviewOptions | null>(null);
const PREVIEW_ASPECT_RATIO = 4 / 3;

export function ChatImage({ source, description = t("图片") }: { source?: string; description?: string }) {
  const imageStyles = useImageStyles();
  const styles = useStyles();
  useLanguage();
  const context = useContext(ChatImageContext);
  const image = useChatImage(source, context);
  const openPreview = useChatImagePreview();
  const previewReady = !image.failed && !image.loading && Boolean(image.url);
  // Loading, decoding and retrying must not resize a measured history row or move the replies below it.
  return <View style={imageStyles.container}>
    {image.failed && <View style={imageStyles.notice}>
      <Text style={styles.subtitle}>
        {context?.ready ? t("{value1}：图片加载失败", { value1: description }) : t("这张图片尚未缓存，连接电脑后查看。")}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t("重新加载：{value1}", { value1: description })} onPress={image.retry}>
        <Text style={styles.buttonText}>{t("重试")}</Text>
      </Pressable>
    </View>}
    {!image.failed && !previewReady && <Text style={styles.status}>{t("正在加载图片…")}</Text>}
    {previewReady && <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button"
      accessibilityLabel={t("放大查看：{value1}", { value1: description })}
      onPress={() => { if (image.url) openPreview({ key: image.key, thumbnail: image.url,
        description, load: image.original, save: image.save }); }}>
      <Image key={image.key} source={{ uri: image.url }} accessibilityLabel={description}
        resizeMode="contain" fadeDuration={0} style={imageStyles.thumbnail} onError={image.fail} />
    </Pressable>}
  </View>;
}

const useImageStyles = createThemedStyles((color) => ({
  container: { width: '100%', aspectRatio: PREVIEW_ASPECT_RATIO, maxHeight: 420, marginVertical: 8,
    borderRadius: 12, backgroundColor: color(palette.pale, 'accentSoft'), alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden' },
  thumbnail: { width: '100%', height: '100%' },
  notice: { maxWidth: 400, gap: 8, paddingVertical: 10 },
}));
