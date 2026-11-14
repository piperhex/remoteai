import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { downloadMarket, listMarket, type MarketExtension } from '../../../../shared/browser/extensions/market';

const bytes = new Uint8Array([80, 75, 3, 4]);
const entry: MarketExtension = { id: '12345678-1234-4234-8234-123456789abc', name: 'Page marker',
  description: 'Mark pages', version: '1.0', permissions: ['storage'], size: bytes.length,
  sha256: bytesToHex(sha256(bytes)), icon: '' };
const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());

describe('extension market package boundaries', () => {
  it('accepts catalog metadata and downloads only its checksum-addressed archive', async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json({ items: [entry] }))
      .mockResolvedValueOnce(new Response(bytes));
    vi.stubGlobal('fetch', request);
    expect(await listMarket('https://market.example/api/', signal())).toEqual([entry]);
    const file = await downloadMarket('https://market.example/api/', entry, signal());
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
    expect(request.mock.calls[1][0]).toBe(`https://market.example/api/browser-extensions/${entry.id}/archive?sha256=${entry.sha256}`);
    expect(request.mock.calls[1][1]).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' });
  });
  it.each([new Uint8Array([80, 75, 3, 5]), new Uint8Array([80, 75]), new Uint8Array(5)])(
    'rejects changed, truncated and oversized downloads', async value => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(value)));
      await expect(downloadMarket('https://market.example', entry, signal())).rejects.toThrow('extensionsDownloadFailed');
    });
  it('rejects duplicate IDs, invalid IDs and malformed permissions', async () => {
    for (const items of [[entry, entry], [{ ...entry, id: '../other' }], [{ ...entry, permissions: 'storage' }]]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ items })));
      await expect(listMarket('https://market.example', signal())).rejects.toThrow();
    }
  });
  it('does not download from a catalog URL containing credentials or an invalid entry', async () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    await expect(downloadMarket('https://user:secret@market.example', entry, signal())).rejects.toThrow();
    await expect(downloadMarket('https://market.example', { ...entry, size: 70 * 1024 * 1024 }, signal())).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
