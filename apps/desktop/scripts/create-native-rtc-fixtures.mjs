import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const directory = resolve(process.argv[2] ?? '../../.codex-tmp/native-rtc-fixtures');
const size = process.argv[3] ?? '640x360';
if (!/^\d{2,4}x\d{2,4}$/.test(size)) throw new Error('Expected a frame size such as 2560x1440');
const fps = Number(process.argv[4] ?? 30);
if (!Number.isInteger(fps) || fps < 1 || fps > 144) throw new Error('Expected a frame rate from 1 to 144');
const bitrate = process.argv[5] ? Number(process.argv[5]) : undefined;
if (bitrate !== undefined && (!Number.isInteger(bitrate) || bitrate < 200_000 || bitrate > 32_000_000)) {
  throw new Error('Expected a bitrate from 200000 to 32000000');
}
await mkdir(directory, { recursive: true });
function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args],
    { windowsHide: true, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
}
for (const codec of ['h264', 'h265']) {
  ffmpeg(['-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${fps}`, '-t', '2', '-an', '-pix_fmt', 'yuv420p',
    '-c:v', codec === 'h264' ? 'libx264' : 'libx265', '-preset', 'ultrafast', '-tune', 'zerolatency',
    ...(bitrate ? ['-b:v', String(bitrate), '-maxrate', String(bitrate), '-bufsize', String(bitrate / 2)] : []),
    ...(codec === 'h264' ? ['-profile:v', 'baseline', '-x264-params', `aud=1:keyint=${fps}:repeat-headers=1`]
      : ['-x265-params', `aud=1:keyint=${fps}:repeat-headers=1:log-level=error:pools=2`]),
    '-f', codec === 'h264' ? 'h264' : 'hevc', join(directory, `pattern.${codec}`)]);
}
ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-ac', '2', '-c:a', 'libopus',
  '-frame_duration', '20', '-page_duration', '20000', '-f', 'ogg', join(directory, 'tone.ogg')]);
const ogg = await readFile(join(directory, 'tone.ogg'));
const packets = []; let pieces = []; let offset = 0;
while (offset < ogg.length) {
  if (ogg.toString('ascii', offset, offset + 4) !== 'OggS') throw new Error('Invalid Ogg fixture');
  const segments = ogg[offset + 26];
  const lacing = ogg.subarray(offset + 27, offset + 27 + segments);
  offset += 27 + segments;
  for (const length of lacing) {
    pieces.push(ogg.subarray(offset, offset + length)); offset += length;
    if (length === 255) continue;
    const packet = Buffer.concat(pieces); pieces = [];
    if (!packet.subarray(0, 4).equals(Buffer.from('Opus'))) {
      const size = Buffer.alloc(4); size.writeUInt32BE(packet.length); packets.push(size, packet);
    }
  }
}
if (pieces.length || !packets.length) throw new Error('Incomplete Opus fixture');
await writeFile(join(directory, 'tone.opus-packets'), Buffer.concat(packets));
console.log(`Native RTC presentation fixtures: ${directory}`);
