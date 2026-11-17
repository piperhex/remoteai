import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { channelBrowser } from '../../../scripts/p2p-channel-browser.mjs';

const executable = process.argv[2];
if (!executable) throw new Error('Pass the compiled Rust test executable; start Vite on 18787 first');
const size = process.argv[3] ?? '640x360';
if (!/^\d{2,4}x\d{2,4}$/.test(size)) throw new Error('Expected a frame size such as 2560x1440');
const [width, height] = size.split('x').map(Number);
const fps = Number(process.argv[4] ?? 30);
if (!Number.isInteger(fps) || fps < 1 || fps > 144) throw new Error('Expected a frame rate from 1 to 144');
const variant = fps === 30 ? size : `${size}-${fps}fps`;
const output = resolve('.codex-tmp/native-rtc', variant === '640x360' ? '.' : variant);
await mkdir(output, { recursive: true });
process.env.NATIVE_RTC_FIXTURES ??= resolve('.codex-tmp/native-rtc-fixtures');
process.env.NATIVE_RTC_FIXTURE_FPS = String(fps);
const nativeLogs = [];
const engine = await channelBrowser(executable, { port: 9367, test: 'native_rtc::harness::opens_native_rtc',
  output: text => nativeLogs.push(text) });
const page = engine.page;
const errors = [];
const logs = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => logs.push({ type: message.type(), text: message.text() }));
try {
  await page.goto('http://127.0.0.1:18787/e2e/native-rtc-harness.html');
  await page.waitForFunction(() => Boolean(window.nativeRtcFixture));
  const supported = await page.evaluate(() => window.nativeRtcFixture.supported());
  const channels = await page.evaluate(() => window.nativeRtcFixture.data());
  const samples = [];
  for (const codec of [...supported].reverse()) {
    await page.evaluate(value => window.nativeRtcFixture.start(value), codec);
    await page.waitForFunction(({ width, height }) => {
      const video = document.querySelector('video');
      if (video) video.muted = true;
      return video?.videoWidth === width && video.videoHeight === height
        && video.getVideoPlaybackQuality().totalVideoFrames > 75;
    }, { width, height }, { timeout: 30000 });
    const cadence = await page.evaluate(async () => {
      const video = document.querySelector('video');
      const before = await window.nativeRtcFixture.mediaStats();
      const presented = video.getVideoPlaybackQuality().totalVideoFrames;
      await new Promise(resolve => setTimeout(resolve, 5000));
      const after = await window.nativeRtcFixture.mediaStats();
      const seconds = (after.timestamp - before.timestamp) / 1000;
      return { decodedFps: (after.framesDecoded - before.framesDecoded) / seconds,
        presentedFps: (video.getVideoPlaybackQuality().totalVideoFrames - presented) / seconds };
    });
    const result = await page.evaluate(async () => {
      const video = document.querySelector('video');
      const context = new AudioContext();
      const source = context.createMediaStreamSource(new MediaStream(video.srcObject.getAudioTracks()));
      const analyser = context.createAnalyser(); const silent = context.createGain(); silent.gain.value = 0;
      source.connect(analyser); analyser.connect(silent); silent.connect(context.destination);
      await context.resume(); await new Promise(resolve => setTimeout(resolve, 150));
      const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
      const audioRms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      source.disconnect(); await context.close();
      return { width: video.videoWidth, height: video.videoHeight,
        frames: video.getVideoPlaybackQuality().totalVideoFrames,
        audioTracks: video.srcObject.getAudioTracks().length, audioRms, browserRtcCalls: window.nativeRtcFixture.calls(),
        body: document.body.innerText };
    });
    if (result.browserRtcCalls || result.audioTracks !== 1 || result.audioRms < 0.001) {
      throw new Error(`Invalid native media result: ${JSON.stringify(result)}`);
    }
    await page.screenshot({ path: resolve(output, `windows-local-${codec}-playing.png`) });
    samples.push({ codec, requestedFps: fps, ...cadence, ...result });
    await page.evaluate(() => window.nativeRtcFixture.close());
    await page.waitForFunction(() => !document.querySelector('video'));
  }
  if (!samples.length || errors.length) throw new Error(`No verified media or page errors: ${errors.join('; ')}`);
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ channels, samples, errors }, null, 2));
  await writeFile(resolve(output, 'native.log'), nativeLogs.join(''));
  if (samples.some(sample => sample.decodedFps < fps * 0.9)) {
    throw new Error(`Native decode cadence fell below 90% of ${fps} FPS: ${JSON.stringify(samples)}`);
  }
  console.log(JSON.stringify({ channels, samples, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png') });
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: String(error), errors, logs, nativeLogs,
    body: await page.locator('body').innerText() }, null, 2));
  throw error;
} finally { await engine.close(); }
