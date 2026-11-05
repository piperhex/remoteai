// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProviderWebsiteIcon } from '../../../../shared/provider-market/ProviderWebsiteIcon';
import { Globe } from 'lucide-react';
import { providerIconSources, providerWebsiteOrigin } from '../../../../shared/provider-market/providerWebsite';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it.each(['', 'file:///preview.txt'])('uses the browser fallback without requesting icons for %s', async url => {
  await act(async () => root.render(<ProviderWebsiteIcon url={url} size={14} fallback={<Globe size={14} />} />));
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('.lucide-globe')).not.toBeNull();
  expect(container.querySelector('span')?.style.width).toBe('14px');
});

it('prefers the configured page and strips API paths, queries, fragments and page credentials', () => {
  const provider = { baseUrl: 'https://api.example.test/v1?key=private', marketSource: {
    id: 'market', page: { url: 'https://www.example.test/dashboard?token=secret#usage',
      query: 'session=private', headers: { Authorization: 'Bearer private' } },
  } };
  expect(providerWebsiteOrigin(provider)).toBe('https://www.example.test');
  expect(providerIconSources(provider.marketSource.page.url)).toEqual([
    'https://www.example.test/favicon.ico', 'https://www.example.test/favicon.png',
  ]);
  expect(providerWebsiteOrigin({ ...provider, marketSource: null })).toBe('https://api.example.test');
  expect(providerIconSources('http://localhost:8080/v1')).toEqual([
    'http://localhost:8080/favicon.ico', 'http://localhost:8080/favicon.png',
  ]);
  expect(providerIconSources('http://constructor/v1')[0]).toBe('http://constructor/favicon.ico');
});

it.each(['javascript:alert(1)', 'file:///secret', 'data:image/svg+xml,test',
  'https://user:secret@example.test', '/relative', undefined])('rejects unsafe icon destination %s', (url) => {
  expect(providerIconSources(url)).toEqual([]);
});

it('uses website icons for API-only endpoints without matching similar domains', () => {
  expect(providerIconSources('https://api.deepseek.com/v1')[0]).toBe('https://www.deepseek.com/favicon.ico');
  expect(providerIconSources('https://ark.cn-beijing.volces.com/api/v3')[0]).toContain('portal.volccdn.com/');
  expect(providerIconSources('https://api.deepseek.com.evil.test/v1')[0])
    .toBe('https://api.deepseek.com.evil.test/favicon.ico');
});

it('keeps a fixed fallback until an image loads, tries PNG, and resets when the site changes', async () => {
  await act(async () => root.render(<ProviderWebsiteIcon url="https://example.test/page?token=secret" />));
  expect(container.querySelector('svg')).not.toBeNull();
  expect(container.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('error')));
  expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.test/favicon.png');
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
  expect(container.querySelector('svg')).toBeNull();
  expect(container.querySelector('img')?.getAttribute('data-loaded')).toBe('true');
  await act(async () => root.render(<ProviderWebsiteIcon url="https://offline.test" />));
  expect(container.querySelector('svg')).not.toBeNull();
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('error')));
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('error')));
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('svg')).not.toBeNull();
  await act(async () => root.render(<ProviderWebsiteIcon url="https://updated.test" />));
  expect(container.querySelector('img')?.getAttribute('src')).toBe('https://updated.test/favicon.ico');
});
