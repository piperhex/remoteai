import { afterEach, expect, it, vi } from 'vitest';
import { desktopVideoCodecs } from '../../../../shared/remote-desktop/codecs';
import { validateSettings } from '../../../../shared/remote-desktop/protocol';

const codecs = () => [{ mimeType: 'video/H265' }, { mimeType: 'video/H264' }];
afterEach(() => vi.useRealTimers());

it('advertises HEVC only when the receiver can decode it efficiently', async () => {
  expect(await desktopVideoCodecs({ codecs, decode: async () => ({ supported: true, powerEfficient: true }) }))
    .toEqual(['h265', 'h264']);
  expect(await desktopVideoCodecs({ codecs, decode: async () => ({ supported: true, powerEfficient: false }) }))
    .toEqual(['h264']);
  expect(await desktopVideoCodecs({ codecs, decode: async () => ({ supported: false, powerEfficient: true }) }))
    .toEqual(['h264']);
});

it('keeps old browsers, native receivers without a hardware probe and failures on H264', async () => {
  expect(await desktopVideoCodecs({ codecs })).toEqual(['h264']);
  const decode = vi.fn(async () => ({ supported: true, powerEfficient: true }));
  expect(await desktopVideoCodecs({ codecs: () => [], decode })).toEqual(['h264']);
  expect(decode).not.toHaveBeenCalled();
  expect(await desktopVideoCodecs({ codecs, decode: async () => { throw new Error('unavailable'); } }))
    .toEqual(['h264']);
});

it('bounds a stalled hardware probe and releases its timeout', async () => {
  vi.useFakeTimers();
  const result = desktopVideoCodecs({ codecs, decode: () => new Promise(() => undefined) });
  await vi.advanceTimersByTimeAsync(1500);
  expect(await result).toEqual(['h264']);
  expect(vi.getTimerCount()).toBe(0);
});

it('validates advertised codecs and always retains the compatibility codec', () => {
  const settings = { fps: 'auto', quality: 'auto' };
  expect(validateSettings({ ...settings, videoCodecs: ['h265', 'h264'] }).videoCodecs).toEqual(['h265', 'h264']);
  for (const videoCodecs of [['h265'], ['h264', 'vp9'], 'h265', [], ['h264', 'h265', 'h264']]) {
    expect(() => validateSettings({ ...settings, videoCodecs })).toThrow();
  }
});
