import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Synthetic latency isolates application round-trip overhead; this is not a network speed test.
const SIZE = 4 * 1024 * 1024;
const LATENCY_MS = 12;
const LEGACY_CHUNK = 12 * 1024;
const CHUNK = 256 * 1024;
const delay = () => new Promise(resolve => setTimeout(resolve, LATENCY_MS));
const temporaryRoot = resolve(tmpdir());
const prefix = 'remoteai-sync-benchmark-';
const directory = await mkdtemp(join(temporaryRoot, prefix));
try {
  const module = join(directory, 'transfer.mjs');
  await build({ entryPoints: [fileURLToPath(new URL('../../../shared/conversation/sync/transfer.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', outfile: module });
  const { uploadPreparedSync } = await import(pathToFileURL(module).href);
  const source = { id: 'source', name: '', request: async request => {
    await delay();
    return { data: Buffer.alloc(Math.min(request.length ?? LEGACY_CHUNK, SIZE - request.offset)).toString('base64') };
  } };
  const destination = { id: 'destination', name: '', request: delay };
  const started = performance.now();
  for (let offset = 0; offset < SIZE; offset += LEGACY_CHUNK) {
    const { data } = await source.request({ offset });
    await destination.request({ offset, data });
  }
  const legacyMs = performance.now() - started;
  const bundle = { id: 'archive', size: SIZE, sha256: '', sessionIds: [], chunkBytes: CHUNK };
  const nextStarted = performance.now();
  await uploadPreparedSync({ prepared: { id: 'incoming', bundle, plan: { count: 1, duplicateIds: [] },
    remote: { host: source, bundle } }, destination, signal: new AbortController().signal, progress: () => {} });
  const currentMs = performance.now() - nextStarted;
  console.log(JSON.stringify({ synthetic: true, bytes: SIZE, latencyPerRequestMs: LATENCY_MS,
    legacy: { milliseconds: Math.round(legacyMs), kibPerSecond: Math.round(SIZE / legacyMs * 1000 / 1024) },
    current: { milliseconds: Math.round(currentMs), kibPerSecond: Math.round(SIZE / currentMs * 1000 / 1024) } }, null, 2));
} finally {
  if (dirname(resolve(directory)) !== temporaryRoot || !basename(directory).startsWith(prefix)) {
    throw new Error('Unexpected benchmark temporary directory');
  }
  await rm(directory, { recursive: true, force: true });
}
