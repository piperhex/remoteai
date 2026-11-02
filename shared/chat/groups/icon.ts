import { GROUP_ICON_LIMIT, GROUP_ICON_SIZE } from './model';

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;

/** Decode locally and store only a bounded, normalized raster icon. */
export async function readGroupIcon(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > MAX_UPLOAD_SIZE) {
    throw new Error('client.groups.iconError');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const size = Math.min(image.naturalWidth, image.naturalHeight);
    if (!size) throw new Error('client.groups.iconError');
    const canvas = document.createElement('canvas');
    canvas.width = GROUP_ICON_SIZE; canvas.height = GROUP_ICON_SIZE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('client.groups.iconError');
    context.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2,
      size, size, 0, 0, GROUP_ICON_SIZE, GROUP_ICON_SIZE);
    const icon = canvas.toDataURL('image/png');
    if (icon.length > GROUP_ICON_LIMIT) throw new Error('client.groups.iconError');
    return icon;
  } finally { URL.revokeObjectURL(url); }
}
