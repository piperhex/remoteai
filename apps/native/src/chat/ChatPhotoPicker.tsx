import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { useEffect, useState } from 'react';
import Feather from '@expo/vector-icons/Feather';
import { Image, Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { palette, useStyles } from './styles';
import { ImageViewer } from './ImageViewer';
import { ChatPhotoEditor } from './ChatPhotoEditor';
import type { useChatPhotos } from './useChatPhotos';
import { itemUploadProgress, type UploadProgress } from '../../../../shared/remote-chat/uploadProgress';
import { ComposerUploadProgress } from './ComposerUploadProgress';

interface Props {
  photos: ReturnType<typeof useChatPhotos>; disabled: boolean; active: boolean;
  upload?: UploadProgress; reconnecting?: boolean;
}

export function ChatPhotoPicker({ photos, disabled, active, upload, reconnecting }: Props) {
  const photoStyles = usePhotoStyles();
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const preview = photos.photos.find((photo) => photo.id === previewId);
  const editing = photos.photos.find((photo) => photo.id === editingId);
  useEffect(() => { if (!active || !preview) setPreviewId(null); }, [active, preview]);
  const busy = disabled || photos.busy;
  useEffect(() => { if (!active || busy || !editing) setEditingId(null); }, [active, busy, editing]);
  if (!photos.photos.length && !photos.busy && !photos.error) return null;
  return <View style={photoStyles.container}>
    {!!photos.photos.length && <ScrollView horizontal keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false} contentContainerStyle={photoStyles.previews}>
      {photos.photos.map((photo, index) => <View key={photo.id} style={photoStyles.card}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("放大查看：照片 {value1}", { value1: index + 1 })}
          style={photoStyles.previewButton} onPress={() => setPreviewId(photo.id)}>
          <Image source={{ uri: photo.uri }} style={photoStyles.preview} resizeMode="cover"
            accessibilityLabel={t("照片 {value1}", { value1: index + 1 })} />
          <ComposerUploadProgress progress={itemUploadProgress(upload, 'image', index)} reconnecting={reconnecting} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("编辑照片 {value1}", { value1: index + 1 })} disabled={busy}
          style={[photoStyles.edit, busy && styles.disabled]}
          onPress={() => { Keyboard.dismiss(); setEditingId(photo.id); }}>
          <Feather name="edit-2" size={12} color="#fff" /><Text style={photoStyles.editText}>{t("编辑")}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("移除照片 {value1}", { value1: index + 1 })} disabled={busy}
          accessibilityState={{ disabled: busy }} hitSlop={6} onPress={() => photos.remove(photo.id)}
          style={[photoStyles.remove, busy && styles.disabled]}>
          <Feather name="x" size={18} color={color(palette.ink, 'ink')} />
        </Pressable>
      </View>)}
    </ScrollView>}
    {photos.busy && <Text style={styles.status}>{t("正在读取照片…")}</Text>}
    {!!photos.error && <Text accessibilityRole="alert" style={styles.error}>{photos.error}</Text>}
    {photos.settingsRequired && <Pressable accessibilityRole="button" onPress={photos.openSettings}>
      <Text style={styles.buttonText}>{t("打开设置")}</Text>
    </Pressable>}
    {active && preview && <ImageViewer key={preview.id} thumbnail={preview.uri}
      description={t("照片 {value1}", { value1: photos.photos.indexOf(preview) + 1 })} load={async () => preview.dataUrl}
      close={() => setPreviewId(null)} />}
    {active && !busy && editing && <ChatPhotoEditor key={editing.id} photo={editing}
      save={(dataUrl) => photos.replace(editing, dataUrl)} close={() => setEditingId(null)} />}
  </View>;
}

const usePhotoStyles = createThemedStyles((color) => ({
  container: { gap: 8 },
  previews: { gap: 10, padding: 4 },
  card: { position: 'relative', width: 96, flexShrink: 0 },
  previewButton: { height: 96, flexShrink: 0 },
  preview: { width: '100%', height: '100%', borderTopLeftRadius: 12,
    borderTopRightRadius: 12, backgroundColor: color(palette.pale, 'accentSoft') },
  edit: { flexDirection: 'row', gap: 4, paddingHorizontal: 8, paddingVertical: 8,
    alignItems: 'center', justifyContent: 'center', minHeight: 40, width: '100%',
    borderBottomLeftRadius: 12, borderBottomRightRadius: 12, backgroundColor: '#0009' },
  // Explicit leading accommodates Android's Chinese fallback font without clipping the label.
  editText: { color: '#fff', fontSize: 12, lineHeight: 20, includeFontPadding: true, textAlignVertical: 'center' },
  remove: { position: 'absolute', top: 4, right: 4, width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', backgroundColor: color(palette.background, 'canvas'),
    borderWidth: StyleSheet.hairlineWidth, borderColor: color(palette.border, 'border') },
}));
