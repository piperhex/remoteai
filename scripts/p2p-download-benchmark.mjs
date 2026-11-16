import { createServer } from 'vite';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testBrowserLaunchOptions } from './test-browser.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
function argument(name, fallback) {
  const index = args.indexOf(name);
  const value = index < 0 ? fallback : args[index + 1];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
const deviceId = argument('--device');
const sourcePath = argument('--file');
const baseUrl = argument('--server');
const expectedHash = argument('--sha256');
const runs = Number(argument('--runs', '3'));
const exposeLanCandidates = args.includes('--expose-lan-candidates');
if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('Runs must be 1–10.');
const auth = JSON.parse(await readFile(argument('--auth-file'), 'utf8'));
if (typeof auth.accessToken !== 'string' || !auth.accessToken) throw new Error('No saved access token.');
const baseline = args.includes('--baseline-ref') ? argument('--baseline-ref') : undefined;
if (baseline && !/^[a-f0-9]{7,40}$/.test(baseline)) throw new Error('Use a shared commit hash for the baseline.');
const overrides = new Map();
if (baseline) {
  for (const file of ['downloads/bulkStorage.ts', 'remote-chat/bulkLimits.ts']) {
    overrides.set(path.resolve(root, 'shared', file).replaceAll('\\', '/'), execFileSync('git',
      ['show', `${baseline}:${file}`], { cwd: path.join(root, 'shared'), encoding: 'utf8' }));
  }
}
const server = await createServer({ configFile: false, root, logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, watch: null }, optimizeDeps: { noDiscovery: true },
  plugins: [{ name: 'benchmark-baseline', enforce: 'pre', load: id => overrides.get(id) }],
});
server.middlewares.use('/__p2p_benchmark', (_request, response) => {
  response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>P2P download benchmark</title>');
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch(testBrowserLaunchOptions({ headless: true,
    // Isolated diagnostic only: compare mDNS host candidates with explicit LAN addresses.
    args: exposeLanCandidates ? ['--disable-features=WebRtcHideLocalIpsWithMdns'] : [],
  }));
  const page = await browser.newPage();
  page.on('console', message => {
    if (message.type() === 'info' && message.text().startsWith('P2P_BENCHMARK ')) console.info(message.text());
  });
  await page.goto(server.resolvedUrls.local[0] + '__p2p_benchmark');
  const result = await page.evaluate(async options => {
    const client = await import('/scripts/p2p-download-benchmark-client.ts');
    return client.run(options);
  }, { deviceId, path: sourcePath, baseUrl, expectedHash, runs, accessToken: auth.accessToken });
  result.storageRevision = baseline ?? 'working-tree';
  result.exposeLanCandidates = exposeLanCandidates;
  const output = path.resolve(argument('--output'));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.info(JSON.stringify({ output, samples: result.samples.map(({ MiBps, verified }) => ({ MiBps, verified })) }));
} finally { await browser?.close(); await server.close(); }
