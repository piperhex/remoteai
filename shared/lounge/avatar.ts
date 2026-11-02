export const AVATAR_SIZE = 128;
// A detailed RGBA PNG can exceed 64 KiB; leave room for PNG framing without reducing image quality.
export const MAX_AVATAR_BYTES = 80 * 1024;
const SUPPORTED_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export interface LoungeAvatarStore {
  load(userId: string): string | undefined;
  save(userId: string, avatar: string): void;
}

export function avatarData(value: unknown): value is string {
  return typeof value === 'string' && value.length <= Math.ceil(MAX_AVATAR_BYTES / 3) * 4 + 32
    && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value);
}

export function browserAvatarStore(baseUrl: string): LoungeAvatarStore {
  const key = (userId: string) => `remoteai:lounge:avatar:${JSON.stringify([baseUrl.replace(/\/+$/, ''), userId])}`;
  return {
    load(userId) {
      try { const value = localStorage.getItem(key(userId)); return value === '' || avatarData(value) ? value : undefined; }
      catch { return undefined; }
    },
    save(userId, avatar) {
      try {
        localStorage.setItem(key(userId), avatar);
      } catch { throw new Error('client.lounge.avatarSaveFailed'); }
    },
  };
}

/** Center-crop once and encode only the avatar-sized bitmap, excluding original metadata. */
export async function prepareAvatar(file: File): Promise<string> {
  if (!SUPPORTED_IMAGES.has(file.type)) throw new Error('client.lounge.imageFormat');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('client.lounge.imageFailed'); }
  try {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = AVATAR_SIZE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('client.lounge.imageFailed');
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side,
      0, 0, AVATAR_SIZE, AVATAR_SIZE);
    const data = canvas.toDataURL('image/png');
    if (!avatarData(data)) throw new Error('client.lounge.imageFailed');
    return data;
  } finally { bitmap.close(); }
}
