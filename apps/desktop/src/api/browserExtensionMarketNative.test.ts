// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
const fetcher = vi.fn(), bytes = new Uint8Array([80, 75, 3, 4]);
const entry = { id: '12345678-1234-4234-8234-123456789abc', name: 'Page marker', description: '',
  version: '1.0', permissions: [], size: bytes.length, sha256: bytesToHex(sha256(bytes)) };
const encode = (value: string | Uint8Array) => Buffer.from(value).toString('base64');
const market = () => import('../../../../shared/browser/extensions/market');

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  document.head.innerHTML = '';
  sessionStorage.clear();
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
  vi.stubGlobal('fetch', fetcher.mockRejectedValue(new TypeError('Blocked by desktop CSP')));
});
afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  document.head.innerHTML = '';
  vi.unstubAllGlobals();
});

it('loads catalogs and verified archives through native IPC while WebView networking is blocked', async () => {
  native.invoke.mockResolvedValueOnce(encode(JSON.stringify({ items: [entry] })))
    .mockResolvedValueOnce(encode(bytes));
  const { listMarket, downloadMarket } = await market();
  const signal = new AbortController().signal;
  expect(await listMarket('https://configured.test/api/', signal)).toEqual([entry]);
  const file = await downloadMarket('https://configured.test/api/', entry, signal);
  const actual = await new Promise<ArrayBuffer>(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer); reader.readAsArrayBuffer(file);
  });
  expect(new Uint8Array(actual)).toEqual(bytes);
  expect(native.invoke.mock.calls).toEqual([
    ['fetch_browser_extension_market', { baseUrl: 'https://configured.test/api/', archive: null }],
    ['fetch_browser_extension_market', { baseUrl: 'https://configured.test/api/', archive: {
      id: entry.id, sha256: entry.sha256, size: entry.size,
    } }],
  ]);
  expect(fetcher).not.toHaveBeenCalled();
});

it('still rejects malformed catalogs and corrupted or oversized native archives', async () => {
  const { listMarket, downloadMarket } = await market();
  native.invoke.mockResolvedValueOnce(encode('{"items":null}'));
  await expect(listMarket('https://market.test', new AbortController().signal)).rejects.toThrow();
  for (const value of [new Uint8Array([80, 75, 3, 5]), new Uint8Array(3), new Uint8Array(5)]) {
    native.invoke.mockResolvedValueOnce(encode(value));
    await expect(downloadMarket('https://market.test', entry, new AbortController().signal)).rejects.toThrow();
  }
});

it('cancels the caller promptly and ignores a late native response', async () => {
  let complete!: (value: string) => void;
  native.invoke.mockReturnValue(new Promise<string>(resolve => { complete = resolve; }));
  const { listMarket } = await market(), controller = new AbortController();
  const pending = listMarket('https://market.test', controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  complete(encode('{"items":[]}'));
  await expect(listMarket('https://market.test', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(native.invoke).toHaveBeenCalledTimes(1);
});

it('routes hosted desktop requests through the authenticated local backend', async () => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  document.head.innerHTML = '<meta name="codex-switch-runtime" content="hosted">';
  sessionStorage.setItem('codex-switch:hosted-web-api-key', 'test-key');
  fetcher.mockResolvedValueOnce(Response.json({ ok: true, result: encode('{"items":[]}') }));
  const { listMarket } = await market();
  expect(await listMarket('https://market.test', new AbortController().signal)).toEqual([]);
  expect(fetcher).toHaveBeenCalledWith('/__codex_switch__/api/invoke', expect.objectContaining({
    headers: expect.objectContaining({ 'X-API-Key': 'test-key' }),
    body: JSON.stringify({ command: 'fetch_browser_extension_market',
      args: { baseUrl: 'https://market.test', archive: null } }),
  }));
  expect(native.invoke).not.toHaveBeenCalled();
});

it('rejects credential-bearing and ambiguous server addresses before invoking native code', async () => {
  const { listMarket } = await market();
  for (const base of ['https://user:secret@market.test', 'file:///private', 'https://market.test?other=1']) {
    await expect(listMarket(base, new AbortController().signal)).rejects.toThrow();
  }
  expect(native.invoke).not.toHaveBeenCalled();
});
