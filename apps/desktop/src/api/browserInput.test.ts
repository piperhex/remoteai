import { expect, it } from 'vitest';
import { browserInput } from '../../../../shared/browser/addressInput';
import { SearchPreference, SEARCH_ENGINE_KEY } from '../../../../shared/browser/searchPreference';

it('searches words, spaces, Chinese and search operators with an encoded query', () => {
  for (const input of ['cats', 'how to use ports', '中文搜索', 'site:example.com a&b #c', 'error: connection lost']) {
    const url = browserInput(input)!;
    expect(url.origin).toBe('https://www.google.com');
    expect(url.searchParams.get('q')).toBe(input);
    expect(url.hash).toBe('');
  }
  expect(browserInput('测试 & 中文', 'baidu')?.searchParams.get('wd')).toBe('测试 & 中文');
  expect(browserInput('test', 'bing')?.hostname).toBe('www.bing.com');
  expect(browserInput('test', 'duckduckgo')?.hostname).toBe('duckduckgo.com');
});

it('keeps URLs, local ports and IPv6 separate from searches', () => {
  expect(browserInput('example.com/a?q=1')?.href).toBe('https://example.com/a?q=1');
  expect(browserInput('例子.测试')?.hostname).toBe('xn--fsqu00a.xn--0zwm56d');
  expect(browserInput('127.0.0.1:18306', 'google', 'http:')?.href).toBe('http://127.0.0.1:18306/');
  expect(browserInput('[::1]:3000', 'google', 'http:')?.href).toBe('http://[::1]:3000/');
  expect(browserInput('https://example.com', 'google', 'http:')?.protocol).toBe('https:');
  for (const input of ['', 'javascript:alert(1)', 'javascript:123', 'data:text/html,hello',
    'file:///secret', 'https://', 'http://user:secret@localhost', 'example.com:99999']) {
    expect(browserInput(input)).toBeNull();
  }
});

it('persists the engine, falls back to Google and reports failed storage without losing the current setting', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
  const preference = new SearchPreference(storage);
  expect(preference.snapshot().engine).toBe('google');
  preference.select('baidu');
  expect(new SearchPreference(storage).snapshot().engine).toBe('baidu');
  storage.setItem = () => { throw new Error('disk full'); };
  preference.select('bing');
  expect(preference.snapshot()).toEqual({ engine: 'baidu', saveError: true });
  values.set(SEARCH_ENGINE_KEY, 'unknown');
  expect(new SearchPreference(storage).snapshot().engine).toBe('google');
});
