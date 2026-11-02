import { launchImageLibraryAsync } from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { GROUP_ICON_LIMIT, GROUP_ICON_SIZE } from '../../../../../shared/chat/groups/model';

export async function pickGroupIcon(): Promise<string | undefined> {
  const result = await launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled) return;
  const asset = result.assets[0];
  if (!asset || (asset.fileSize ?? 0) > 5 * 1024 * 1024
    || (asset.mimeType && !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType))) {
    throw new Error('client.groups.iconError');
  }
  const size = Math.min(asset.width, asset.height);
  if (!size) throw new Error('client.groups.iconError');
  const icon = await manipulateAsync(asset.uri, [
    { crop: { originX: Math.floor((asset.width - size) / 2), originY: Math.floor((asset.height - size) / 2),
      width: size, height: size } }, { resize: { width: GROUP_ICON_SIZE, height: GROUP_ICON_SIZE } },
  ], { format: SaveFormat.PNG, base64: true });
  const source = `data:image/png;base64,${icon.base64 ?? ''}`;
  if (!icon.base64 || source.length > GROUP_ICON_LIMIT) throw new Error('client.groups.iconError');
  return source;
}
