/** Supply HEVC's coded size explicitly: Windows hardware decoders otherwise may scale to their default size. */
export interface HevcDimensions {
  codedWidth: number; codedHeight: number;
  crop: { x: number; y: number; width: number; height: number };
}
export function hevcDimensions(frame: Uint8Array): HevcDimensions | undefined {
  for (let offset = 0; offset + 5 < frame.length; offset += 1) {
    if (frame[offset] || frame[offset + 1] || frame[offset + 2] !== 1 || (frame[offset + 3] >> 1 & 63) !== 33) continue;
    const start = offset + 5;
    let end = Math.min(frame.length, start + 16 * 1024);
    for (let next = start; next + 3 < end; next += 1) {
      if (!frame[next] && !frame[next + 1] && (frame[next + 2] === 1
        || !frame[next + 2] && frame[next + 3] === 1)) { end = next; break; }
    }
    try { return dimensions(frame.subarray(start, end)); } catch { return; }
  }
}

class Bits {
  private offset = 0;
  private readonly bytes: Uint8Array;
  constructor(input: Uint8Array) {
    const bytes = new Uint8Array(input.length); let length = 0;
    for (let index = 0; index < input.length; index += 1) {
      if (index >= 2 && input[index] === 3 && input[index - 1] === 0 && input[index - 2] === 0) continue;
      bytes[length++] = input[index];
    }
    this.bytes = bytes.subarray(0, length);
  }
  read(count: number): number {
    if (this.offset + count > this.bytes.length * 8) throw new Error('Truncated HEVC parameter set');
    let result = 0;
    for (let index = 0; index < count; index += 1) {
      result = result * 2 + (this.bytes[this.offset >> 3] >> (7 - (this.offset & 7)) & 1); this.offset += 1;
    }
    return result;
  }
  skip(count: number) {
    if (this.offset + count > this.bytes.length * 8) throw new Error('Truncated HEVC parameter set');
    this.offset += count;
  }
  unsigned() {
    let zeros = 0;
    while (!this.read(1)) { if (++zeros > 24) throw new Error('Invalid HEVC dimension'); }
    return 2 ** zeros - 1 + this.read(zeros);
  }
}

function dimensions(bytes: Uint8Array) {
  const bits = new Bits(bytes);
  bits.skip(4); const layers = bits.read(3); bits.skip(1);
  bits.skip(96);
  const flags = Array.from({ length: layers }, () => [bits.read(1), bits.read(1)]);
  if (layers) bits.skip((8 - layers) * 2);
  for (const [profile, level] of flags) { if (profile) bits.skip(88); if (level) bits.skip(8); }
  bits.unsigned(); const chroma = bits.unsigned();
  if (chroma > 3) throw new Error('Invalid HEVC chroma format');
  const separate = chroma === 3 ? bits.read(1) : 0;
  const codedWidth = bits.unsigned(), codedHeight = bits.unsigned();
  if (codedWidth < 1 || codedHeight < 1 || codedWidth > 16384 || codedHeight > 16384) {
    throw new Error('Invalid HEVC dimensions');
  }
  const crop = { x: 0, y: 0, width: codedWidth, height: codedHeight };
  if (bits.read(1)) {
    const unitX = !separate && (chroma === 1 || chroma === 2) ? 2 : 1;
    const unitY = !separate && chroma === 1 ? 2 : 1;
    crop.x = bits.unsigned() * unitX;
    const right = bits.unsigned() * unitX;
    crop.y = bits.unsigned() * unitY;
    const bottom = bits.unsigned() * unitY;
    crop.width -= crop.x + right; crop.height -= crop.y + bottom;
    if (crop.width <= 0 || crop.height <= 0) throw new Error('Invalid HEVC crop');
  }
  return { codedWidth, codedHeight, crop };
}
