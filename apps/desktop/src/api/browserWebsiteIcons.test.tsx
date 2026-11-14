// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { BrowserWebsiteIcon } from '../../../../shared/browser/icons/BrowserWebsiteIcon';
import { rememberWebsiteIcons, websiteIconSnapshot } from '../../../../shared/browser/icons/websiteIcons';
import { readPageIcons } from '../../../../shared/browser/icons/pageIcons';
import { providerIconSources } from '../../../../shared/provider-market/providerWebsite';

afterEach(() => vi.unstubAllGlobals());

it('reads relative, base and CDN icon declarations without unsafe URLs or inactive media', () => {
  const page = document.implementation.createHTMLDocument('Icons');
  page.head.innerHTML = `<base href="https://site.test/app/">
    <link rel="shortcut ICON" href="../assets/site.png">
    <link rel="icon" href="https://cdn.test/logo.svg">
    <link rel="icon" href="https://cdn.test/logo.svg">
    <link rel="icon" href="javascript:alert(1)">
    <link rel="icon" href="https://user:password@site.test/icon.png">
    <link rel="icon" media="not all" href="unused.png">
    <link rel="apple-touch-icon" href="touch.png">`;
  expect(readPageIcons(page)).toEqual(['https://site.test/assets/site.png',
    'https://cdn.test/logo.svg', 'https://site.test/app/touch.png']);
});

it('shares discovered icons by origin, bounds input and never caches page paths or credentials', () => {
  const url = 'https://cache.test/private?secret=value';
  rememberWebsiteIcons(url, ['file:///secret', 'https://user:secret@cache.test/icon.png',
    'https://cache.test/assets/icon.svg', 'https://cache.test/assets/icon.svg']);
  expect(websiteIconSnapshot('https://cache.test/bookmark')).toBe('https://cache.test/assets/icon.svg');
  expect(websiteIconSnapshot('https://cache.test.evil')).toBe('');
  expect(localStorage.getItem('remoteai:website-icons:v1')).not.toMatch(/private|secret/);
  rememberWebsiteIcons(url, undefined);
  expect(websiteIconSnapshot(url)).toBe('https://cache.test/assets/icon.svg');
});

it('updates existing tabs and bookmarks when metadata arrives, falls back, and resets on navigation', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<BrowserWebsiteIcon url="https://live.test/page" />));
    expect(container.querySelector('.lucide-globe')).not.toBeNull();
    await act(async () => rememberWebsiteIcons('https://live.test/page', ['https://cdn.test/real.png']));
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.test/real.png');
    await act(async () => container.querySelector('img')!.dispatchEvent(new Event('load')));
    expect(container.querySelector('svg')).toBeNull();
    await act(async () => container.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://live.test/favicon.ico');
    await act(async () => root.render(<BrowserWebsiteIcon url="https://other.test" />));
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://other.test/favicon.ico');
    expect(container.querySelector('.lucide-globe')).not.toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it('uses the public ChatGPT icon even for existing bookmarks with no cached page metadata', () => {
  expect(providerIconSources('https://chatgpt.com/c/private')[0])
    .toBe('https://chatgpt.com/cdn/assets/favicon-48x48.7d42b2e65f.png');
  expect(providerIconSources('https://chatgpt.com.evil/')[0]).toBe('https://chatgpt.com.evil/favicon.ico');
});
