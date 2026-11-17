import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { channelBrowser } from '../../../scripts/p2p-channel-browser.mjs';

const [executable, output = '.codex-tmp/chat-sync-benchmark.json', mib = '32', runs = '3',
  selected = 'js-rpc,rust-rpc,rust-binary'] = process.argv.slice(2);
const modes = selected.split(',');
if (!modes.length || modes.some(mode => !['js-rpc', 'rust-rpc', 'rust-binary'].includes(mode))) {
  throw new Error('Invalid comparison mode');
}
if (!executable) throw new Error('Pass the isolated Rust test executable; start Vite on 18787');
const options = { mib: Number(mib), runs: Number(runs) };
if (!Number.isInteger(options.mib) || options.mib < 1 || options.mib > 128
  || !Number.isInteger(options.runs) || options.runs < 1 || options.runs > 5) throw new Error('Invalid sample size');
const logs = [], errors = [];
process.env.NATIVE_RTC_TEST_LOOPBACK = '1';
const engine = await channelBrowser(executable, { port: 9367, test: 'native_rtc::harness::opens_native_rtc',
  output: text => logs.push(text) });
try {
  engine.page.on('pageerror', error => errors.push(String(error)));
  engine.page.on('console', message => logs.push(message.text()));
  await engine.page.goto('http://127.0.0.1:18787/e2e/native-rtc-harness.html');
  await engine.page.waitForFunction(() => Boolean(window.nativeRtcFixture));
  const tcpInterop = await engine.page.evaluate(() => window.nativeRtcFixture.tcpCrypto());
  console.log(JSON.stringify({ tcpInterop }));
  const nestedPaths = await engine.page.evaluate(() => window.nativeRtcFixture.chatSync({
    mode: 'rust-rpc', mib: 1, runs: 1, envelopes: 2,
  }));
  console.log(JSON.stringify({ nestedPaths }));
  const results = [];
  for (const mode of modes) {
    const result = await engine.page.evaluate(options => window.nativeRtcFixture.chatSync(options), { ...options, mode });
    results.push(result); console.log(JSON.stringify(result));
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify({ options, tcpInterop, nestedPaths, results, errors,
    browserVersion: engine.browser.version() }, null, 2));
} catch (error) {
  await writeFile(`${output}.failure.json`, JSON.stringify({ error: String(error), errors, logs }, null, 2)); throw error;
} finally { await engine.close(); }
