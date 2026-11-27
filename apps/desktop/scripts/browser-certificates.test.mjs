import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../src-tauri/src/provider_browser/certificates/interstitial.js', import.meta.url));
const inspect = runInNewContext('(' + source + ')');

function documentFor(url, policy) {
  const link = { isConnected: true, click: vi.fn() };
  const document = { documentURI: url, readyState: 'complete', defaultView: { loadTimeData: { data_: policy } },
    querySelector: () => ({ querySelector: () => link }) };
  return { document, link };
}

it('only augments a browser-owned overridable certificate error with an existing continue action', async () => {
  const uri = 'chrome-error://chromewebdata/';
  const policy = { type: 'SSL', overridable: true, pem: 'test certificate', errorCode: 'net::ERR_CERT_DATE_INVALID' };
  for (const [url, data] of [
    ['https://example.test/', policy], [uri, { ...policy, overridable: false }], [uri, { ...policy, type: 'BLOCKED' }],
  ]) {
    const { document, link } = documentFor(url, data);
    expect(await inspect.call(document)).toBeNull();
    expect(link.click).not.toHaveBeenCalled();
  }
  const { document, link } = documentFor(uri, policy);
  expect(await inspect.call({ ...document, querySelector: () => null })).toBeNull();
  const challenge = await inspect.call(document);
  expect(challenge.pem).toBe(policy.pem);
  expect(link.click).not.toHaveBeenCalled();
  challenge.proceed();
  expect(link.click).toHaveBeenCalledOnce();
});
