import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, open, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { channelBrowser } from './p2p-channel-browser.mjs';
import { channelRust } from './p2p-channel-rust.mjs';

const [serial, output, highWaterKiB = '256', recordKiB = '16', webviewTestExecutable] = process.argv.slice(2);
if (!serial || !output) throw new Error('Usage: node scripts/benchmark-android-data-channel.mjs SERIAL REPORT [HIGH_KiB] [RECORD_KiB]');
const highWaterBytes = Number(highWaterKiB) * 1024;
const recordBytes = Number(recordKiB) * 1024;
if (![highWaterBytes, recordBytes].every(Number.isSafeInteger) || recordBytes < 1024
  || highWaterBytes < recordBytes || highWaterBytes > 4 * 1024 * 1024 || 134217728 % recordBytes) {
  throw new Error('Invalid benchmark buffer sizes');
}
const nativeApp = process.env.P2P_BENCH_NATIVE_APP === '1';
const lowWaterBytes = process.env.P2P_BENCH_LOW_KIB ? Number(process.env.P2P_BENCH_LOW_KIB) * 1024
  : nativeApp ? 768 * 1024 : highWaterBytes / 4;
if (nativeApp && (highWaterBytes !== 1024 * 1024 || lowWaterBytes !== 768 * 1024)) {
  throw new Error('The desktop builder uses its production 1024/768 KiB file window');
}
if (!Number.isSafeInteger(lowWaterBytes) || lowWaterBytes < 0 || lowWaterBytes >= highWaterBytes) {
  throw new Error('Invalid benchmark low threshold');
}
const config = { runs: 3, records: 134217728 / recordBytes, recordBytes,
  encrypted: nativeApp || process.env.P2P_BENCH_ENCRYPTED === '1',
  yieldBatches: process.env.P2P_BENCH_YIELD_BATCHES === '1',
  highWaterBytes, lowWaterBytes, pulseTimer: process.env.P2P_BENCH_PULSE_TIMER === '1',
  socketMode: process.env.P2P_BENCH_SOCKET_MODE ?? 'ephemeral', udpBufferKiB: Number(process.env.P2P_BENCH_UDP_KIB ?? '0'),
  workers: nativeApp ? undefined : Number(process.env.P2P_BENCH_WORKERS ?? '4') };
const port = 18786;
const slots = new Map();
for (const key of ['offer', 'answer', 'report']) {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  slots.set(`/${key}`, { promise, resolve });
}

function adb(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('adb', ['-s', serial, ...args], { windowsHide: true });
    let result = '';
    child.stdout.on('data', (data) => { result += data; });
    child.stderr.on('data', (data) => { result += data; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve(result) : reject(new Error(`adb ${code}: ${result}`)));
  });
}

async function respond(request, response) {
  response.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:18787');
  if (request.url === '/') { response.end('<script type="module">import {benchmark} from "/sender.js"; window.benchmark=benchmark;</script>'); return; }
  if (request.url === '/sender.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(await readFile(new URL('./p2p-channel-sender.mjs', import.meta.url))); return;
  }
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/config') { response.end(JSON.stringify(config)); return; }
  const slot = slots.get(request.url);
  if (!slot) { response.writeHead(404); response.end('{}'); return; }
  if (request.method === 'POST') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    slot.resolve(JSON.parse(Buffer.concat(chunks).toString())); response.end('{}');
  } else response.end(JSON.stringify(await slot.promise));
}

const server = createServer((request, response) => {
  respond(request, response).catch((error) => { response.writeHead(500); response.end(String(error)); });
});
let browser;
let engine;
let reversed = false;
let instrumentation;
let timeout;
let rust;
let sourceFile;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const existing = await adb(['reverse', '--list']);
  if (existing.includes(`tcp:${port}`)) throw new Error('Benchmark control reverse port is already in use');
  await adb(['reverse', `tcp:${port}`, `tcp:${port}`]); reversed = true;
  if (nativeApp) {
    process.env.NATIVE_RTC_FIXTURES = resolve('.codex-tmp/native-rtc-fixtures');
    await mkdir(process.env.NATIVE_RTC_FIXTURES, { recursive: true });
    const filename = join(process.env.NATIVE_RTC_FIXTURES, 'encrypted-benchmark.bin');
    const file = await open(filename, 'wx'); sourceFile = filename;
    try { for (let block = 0; block < 128; block++) await file.write(randomBytes(1048576)); }
    finally { await file.close(); }
    engine = await channelBrowser(webviewTestExecutable, { port: 9367, test: 'native_rtc::harness::opens_native_rtc' });
    browser = engine.browser;
    await engine.page.goto('http://127.0.0.1:18787/e2e/native-rtc-harness.html');
    await engine.page.waitForFunction(() => Boolean(window.nativeRtcFixture));
  } else if (process.env.P2P_BENCH_RUST === '1') rust = channelRust(webviewTestExecutable);
  else {
    engine = await channelBrowser(webviewTestExecutable);
    browser = engine.browser;
    await engine.page.goto(`http://127.0.0.1:${port}`);
    await engine.page.waitForFunction(() => typeof window.benchmark === 'function');
  }
  instrumentation = adb(['shell', 'am', 'instrument', '-w', '-e', 'class',
    'com.codexswitch.downloads.DataChannelThroughputBenchmark',
    'com.codexswitch.mobile.downloadtest.test/com.codexswitch.downloads.DownloadTestRunner']);
  // Attach rejection handling immediately while the browser drives the transfer.
  instrumentation.catch(() => {});
  const failedInstrumentation = instrumentation.then((log) => {
    if (!/OK \(1 test\)/.test(log)) throw new Error(log);
    return new Promise(() => {});
  });
  const expired = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Transport benchmark timed out')), 240000);
  });
  const sender = await Promise.race([
    rust?.result ?? engine.page.evaluate(({ options, nativeApp }) => nativeApp
      ? window.nativeRtcFixture.phone(options) : window.benchmark(options), { options: config, nativeApp }),
    failedInstrumentation, expired,
  ]);
  const receiver = await slots.get('/report').promise;
  const log = await instrumentation;
  if (!/OK \(1 test\)/.test(log)) throw new Error(log);
  const report = { config, nativeApp, browserVersion: browser?.version() ?? 'native-webrtc-rs', webviewProfile: engine?.identifier,
    sender, receiver, instrumentation: log };
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  clearTimeout(timeout);
  rust?.close();
  await engine?.close();
  if (sourceFile) await unlink(sourceFile);
  // Stop only our isolated test package if a diagnostic failed before completion.
  if (instrumentation) await adb(['shell', 'am', 'force-stop', 'com.codexswitch.mobile.downloadtest']);
  if (reversed) await adb(['reverse', '--remove', `tcp:${port}`]);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
