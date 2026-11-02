import { expect, it, vi } from 'vitest';
import { pickGroupIcon } from './icon';

const mocks = vi.hoisted(() => ({ pick: vi.fn(), encode: vi.fn() }));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: mocks.pick }));
vi.mock('expo-image-manipulator', () => ({ manipulateAsync: mocks.encode, SaveFormat: { PNG: 'png' } }));

it('normalizes a rectangular selection to a centered 128px PNG icon', async () => {
  mocks.pick.mockResolvedValue({ canceled: false, assets: [{ uri: 'local-image', width: 512, height: 256,
    mimeType: 'image/png', fileSize: 1000 }] });
  mocks.encode.mockResolvedValue({ base64: 'encoded' });
  expect(await pickGroupIcon()).toBe('data:image/png;base64,encoded');
  expect(mocks.encode).toHaveBeenCalledWith('local-image', [
    { crop: { originX: 128, originY: 0, width: 256, height: 256 } }, { resize: { width: 128, height: 128 } },
  ], { format: 'png', base64: true });
});

it('preserves the previous icon on cancellation and rejects oversize uploads', async () => {
  mocks.pick.mockResolvedValueOnce({ canceled: true });
  expect(await pickGroupIcon()).toBeUndefined();
  mocks.pick.mockResolvedValueOnce({ canceled: false, assets: [{ fileSize: 6 * 1024 * 1024 }] });
  await expect(pickGroupIcon()).rejects.toThrow('client.groups.iconError');
});
