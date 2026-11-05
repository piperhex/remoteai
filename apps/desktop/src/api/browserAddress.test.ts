import { describe, expect, it } from 'vitest';
import { browserAddress } from '../../../../shared/provider-market/browserAddress';

describe('browser address input', () => {
  it.each([
    ['example.com', 'https://example.com/'],
    ['  example.com/path?q=one%20two#section  ', 'https://example.com/path?q=one%20two#section'],
    ['//example.com/path', 'https://example.com/path'],
    ['example.com:8443/path', 'https://example.com:8443/path'],
    ['localhost:3000/path', 'https://localhost:3000/path'],
    ['127.0.0.1:3000', 'https://127.0.0.1:3000/'],
    ['[::1]:3000', 'https://[::1]:3000/'],
    ['例子.测试', 'https://xn--fsqu00a.xn--0zwm56d/'],
    ['http://localhost:3000/page', 'http://localhost:3000/page'],
    ['HTTPS://EXAMPLE.COM/path', 'https://example.com/path'],
  ])('normalizes %s without changing an explicit web protocol', (input, expected) => {
    expect(browserAddress(input)?.href).toBe(expected);
  });

  it.each(['', ' ', 'javascript:alert(1)', 'javascript:123', 'data:text/html,test', 'file:///secret',
    'ftp://example.com', 'mailto:user@example.com', '/relative', 'example.com:99999',
    'https://user:secret@example.com', 'user:secret@example.com', 'bad host.test', 'example.com\\secret'])
  ('rejects unsafe or malformed addresses: %s', input => {
    expect(browserAddress(input)).toBeNull();
  });
});
