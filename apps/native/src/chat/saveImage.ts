import { t } from '../i18n';
import { base64Bytes, checkDownloadSize } from '../../../../shared/remote-chat/policy';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { randomUUID } from 'expo-crypto';
import ReactNativeBlobUtil from 'react-native-blob-util';

const SCOPED_STORAGE_API = 29;
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
};
export class ImageSavePermissionError extends Error {}
const usesMediaStore = () => Platform.OS === 'android' && Number(Platform.Version) >= SCOPED_STORAGE_API;

async function requestSavePermission() {
  if (usesMediaStore()) return;
  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) throw new ImageSavePermissionError(t("请允许保存照片后重试"));
}

async function prepareImage(source: string, directory: string, mimeType?: string) {
  if (source.startsWith('file://') && mimeType && EXTENSIONS[mimeType]) {
    const uri = `${directory}image.${EXTENSIONS[mimeType]}`;
    await FileSystem.copyAsync({ from: source, to: uri });
    return { uri, mime: mimeType };
  }
  const inline = /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=]+)$/i.exec(source);
  if (inline) {
    checkDownloadSize(base64Bytes(source));
    const mime = inline[1].toLowerCase();
    const uri = `${directory}image.${EXTENSIONS[mime]}`;
    await FileSystem.writeAsStringAsync(uri, inline[2], { encoding: FileSystem.EncodingType.Base64 });
    return { uri, mime };
  }
  if (!/^https?:\/\//i.test(source)) throw new Error('Unsupported image source');
  const download = await FileSystem.downloadAsync(source, `${directory}download`);
  const header = Object.entries(download.headers).find(([name]) => name.toLowerCase() === 'content-type');
  const mime = header?.[1].split(';')[0].trim().toLowerCase() ?? '';
  if (download.status !== 200 || !EXTENSIONS[mime]) throw new Error('Invalid image response');
  const info = await FileSystem.getInfoAsync(download.uri);
  if (!info.exists || info.isDirectory) throw new Error(t("图片暂时无法保存，请重试。"));
  checkDownloadSize(info.size);
  const uri = `${directory}image.${EXTENSIONS[mime]}`;
  await FileSystem.moveAsync({ from: download.uri, to: uri });
  return { uri, mime };
}

/** Save the original bytes; preview gestures never modify the album copy. */
export async function saveImage(source: string, mimeType?: string): Promise<void> {
  await requestSavePermission();
  if (!FileSystem.cacheDirectory) throw new Error('Image cache unavailable');
  const id = randomUUID();
  const directory = `${FileSystem.cacheDirectory}save-image-${id}/`;
  try {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    const { uri, mime } = await prepareImage(source, directory, mimeType);
    if (usesMediaStore()) {
      // MediaStore writes on Android 10+ require no permission to read the user's photos.
      await ReactNativeBlobUtil.MediaCollection.copyToMediaStore({
        name: `RemoteAI-${id}.${EXTENSIONS[mime]}`, parentFolder: 'Remote AI', mimeType: mime,
      }, 'Image', uri.replace(/^file:\/\//, ''));
    } else {
      await MediaLibrary.saveToLibraryAsync(uri);
    }
  } finally {
    await FileSystem.deleteAsync(directory, { idempotent: true })
      .catch(() => console.warn('Unable to remove temporary image copy'));
  }
}
