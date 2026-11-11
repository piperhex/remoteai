import { createServer, get, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { afterEach, expect, it } from 'vitest';
import { isInstallationProgress, observePackageDownloads } from './downloadProgress';
import type { InstallationProgress } from '../../../shared/cli/installProgressTypes';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).reverse().forEach(cleanup => cleanup()); });

async function fixture(serve: (response: ServerResponse) => void) {
  const server = createServer((_request, response) => serve(response));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanups.push(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  const progress: InstallationProgress[] = [];
  cleanups.push(observePackageDownloads(value => progress.push(value)));
  const read = (name: string) => new Promise<Buffer>((resolve, reject) => {
    const request = get(`http://127.0.0.1:${address.port}/${name}`, { headers: { host: 'registry.npmjs.org' } }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(chunk));
      response.once('error', reject);
      response.once('end', () => resolve(Buffer.concat(chunks)));
    });
    request.once('error', reject);
  });
  return { progress, read };
}

it('measures received archive bytes and content length without consuming npm response data', async () => {
  const { progress, read } = await fixture(response => {
    response.writeHead(200, { 'content-length': 12 });
    response.write('firs');
    setTimeout(() => response.write('t-se'), 130);
    setTimeout(() => response.end('cond'), 260);
  });
  expect((await read('cli-1.0.0.tgz')).toString()).toBe('first-second');
  expect(progress[0]).toEqual({ phase: 'downloading', downloaded: 0, total: 12, fileName: 'cli-1.0.0.tgz' });
  expect(progress.at(-1)).toMatchObject({ phase: 'installing', downloaded: 12, total: 12 });
  expect(progress).toContainEqual({ phase: 'downloading', downloaded: 8, total: 12, fileName: 'cli-1.0.0.tgz' });
  expect(progress.every(isInstallationProgress)).toBe(true);
});

it('keeps unknown lengths indeterminate until the download finishes', async () => {
  const { progress, read } = await fixture(response => {
    response.writeHead(200); response.write('first-');
    setTimeout(() => response.end('second'), 130);
  });
  await read('unknown.tgz');
  expect(progress.filter(value => value.phase === 'downloading').every(value => value.total === undefined)).toBe(true);
  expect(progress.at(-1)).toMatchObject({ downloaded: 12, total: 12 });
});

it('keeps concurrent files separate and ignores registry metadata', async () => {
  const { progress, read } = await fixture(response => {
    response.writeHead(200, { 'content-length': 4 }); response.write('ab');
    setTimeout(() => response.end('cd'), 130);
  });
  const contents = await Promise.all([read('one.tgz'), read('two.tgz'), read('package.json')]);
  expect(contents.map(value => value.toString())).toEqual(['abcd', 'abcd', 'abcd']);
  expect(new Set(progress.map(value => value.fileName))).toEqual(new Set(['one.tgz', 'two.tgz']));
  expect(progress.every(value => value.downloaded <= 4 && value.total === 4)).toBe(true);
});

it('does not mark a truncated download complete and rejects invalid IPC values', async () => {
  const { progress, read } = await fixture(response => {
    response.writeHead(200, { 'content-length': 10 }); response.write('part');
    setTimeout(() => response.destroy(), 130);
  });
  await expect(read('broken.tgz')).rejects.toThrow();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(progress.at(-1)).toMatchObject({ phase: 'preparing', downloaded: 4, total: 10 });
  for (const value of [null, { phase: 'downloading', downloaded: -1 },
    { phase: 'ready', downloaded: 4 }, { phase: 'downloading', downloaded: 4, total: '10' }]) {
    expect(isInstallationProgress(value)).toBe(false);
  }
});
