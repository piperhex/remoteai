import { expect, it } from 'vitest';
import { hevcDimensions } from './hevcDimensions';

const sps = Uint8Array.from(Buffer.from(
  '00000142010101600000030090000003000003003fa005020171f2e5ba4a4c2f016808000003000800000300f040', 'hex'));

it('reads an HEVC SPS with emulation prevention and preserves its conformance crop', () => {
  expect(hevcDimensions(sps)).toEqual({ codedWidth: 640, codedHeight: 368,
    crop: { x: 0, y: 0, width: 640, height: 360 } });
});

it('does not configure a decoder from missing or truncated parameter sets', () => {
  expect(hevcDimensions(new Uint8Array(40))).toBeUndefined();
  expect(hevcDimensions(sps.slice(0, 12))).toBeUndefined();
});
