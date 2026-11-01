import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ info: vi.fn(), read: vi.fn(), remove: vi.fn(), encode: vi.fn(), pick: vi.fn() }));
vi.mock('expo-file-system', () => ({ getInfoAsync: mocks.info, readAsStringAsync: mocks.read,
  deleteAsync: mocks.remove, EncodingType: { Base64: 'base64' } }));
vi.mock('expo-image-manipulator', () => ({ manipulateAsync: mocks.encode, SaveFormat: { JPEG: 'jpeg', PNG: 'png' } }));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: mocks.pick }));
import { pickLoungeImages, prepareNativeImage } from './images';

const asset = { uri: 'file:///photo.png', width: 3000, height: 2000, mimeType: 'image/png' };
beforeEach(() => {
  vi.resetAllMocks(); mocks.info.mockResolvedValue({ exists: true, size: 2 * 1024 * 1024 });
  mocks.remove.mockResolvedValue(undefined);
});
describe('native lounge attachments', () => {
  it('retries compression until the actual encoded bytes fit, and removes every generated file', async () => {
    mocks.encode.mockResolvedValueOnce({ uri: 'file:///large.jpg', base64: 'A'.repeat(1400000) })
      .mockResolvedValueOnce({ uri: 'file:///small.jpg', base64: 'AAAA' });
    expect(await prepareNativeImage(asset)).toBe('data:image/jpeg;base64,AAAA');
    expect(mocks.encode).toHaveBeenCalledTimes(2);
    expect(mocks.encode.mock.calls[0][2].compress).toBeGreaterThan(mocks.encode.mock.calls[1][2].compress);
    expect(mocks.remove.mock.calls.map(call => call[0])).toEqual(['file:///large.jpg', 'file:///small.jpg']);
  });
  it('preserves a small GIF without conversion', async () => {
    mocks.info.mockResolvedValue({ exists: true, size: 3 }); mocks.read.mockResolvedValue('AAAA');
    expect(await prepareNativeImage({ ...asset, mimeType: 'image/gif' })).toBe('data:image/gif;base64,AAAA');
    expect(mocks.encode).not.toHaveBeenCalled();
  });
  it('center crops avatars to 128px PNG and rejects output over the avatar limit', async () => {
    mocks.encode.mockResolvedValue({ uri: 'file:///avatar.png', base64: 'AAAA' });
    expect(await prepareNativeImage(asset, true)).toBe('data:image/png;base64,AAAA');
    expect(mocks.encode).toHaveBeenCalledWith(asset.uri, [{ crop: {
      originX: 500, originY: 0, width: 2000, height: 2000,
    } }, { resize: { width: 128, height: 128 } }], { base64: true, format: 'png', compress: 1 });
    mocks.encode.mockResolvedValue({ uri: 'file:///invalid.png', base64: 'A'.repeat(120000) });
    await expect(prepareNativeImage(asset, true)).rejects.toThrow('client.lounge.imageFailed');
  });
  it('handles cancellation and enforces the remaining image limit before reading photos', async () => {
    mocks.pick.mockResolvedValue({ canceled: true });
    expect(await pickLoungeImages()).toEqual({ images: [], flattened: false });
    mocks.pick.mockResolvedValue({ canceled: false, assets: [asset, asset] });
    await expect(pickLoungeImages({ remaining: 1 })).rejects.toThrow('client.lounge.tooManyImages');
    expect(mocks.info).not.toHaveBeenCalled();
  });
});
