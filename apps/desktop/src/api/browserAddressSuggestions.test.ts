import { describe, expect, it } from 'vitest';
import { addressSuggestions, MAX_ADDRESS_SUGGESTIONS } from '../../../../shared/browser/addressSuggestions';
import type { BrowserRecord, Visit } from '../../../../shared/browser/data/model';

const visit = (url: string, title = '', at = 1): Visit => ({ id: `${at}`, kind: 'visit', url, title, at });

describe('address history suggestions', () => {
  it('matches host prefixes before more recent title/path matches, ignoring case and www', () => {
    const prefix = visit('https://www.cloud.example.com/admin', 'Account', 1);
    const title = visit('https://example.com/docs', 'Cloud guide', 3);
    const path = visit('https://example.com/cloud', 'Notes', 2);
    expect(addressSuggestions([path, title, prefix], ' CLO ')).toEqual([prefix, title, path]);
  });

  it('deduplicates normalized URLs using the newest visit and preserves distinct paths and queries', () => {
    const latest = visit('https://example.com/', 'New title', 4);
    const second = visit('https://example.com/docs?q=2', 'Docs', 3);
    const first = visit('https://example.com/docs?q=1', 'Docs', 2);
    expect(addressSuggestions([visit('https://example.com', 'Old title'), first, second, latest], 'example'))
      .toEqual([latest, second, first]);
  });

  it('matches Chinese titles, decoded URLs and multiple words', () => {
    const entry = visit('https://example.com/%E6%96%87%E6%A1%A3', '开发指南');
    expect(addressSuggestions([entry], '文档 开发')).toEqual([entry]);
    expect(addressSuggestions([entry], 'not visited')).toEqual([]);
  });

  it('limits recent history and does not suggest credentials or unsafe URLs', () => {
    const history = Array.from({ length: 20 }, (_, index) => visit(`https://example.com/${index}`, '', index));
    const password: BrowserRecord = { id: 'password', kind: 'password', at: 99, salt: '',
      secret: { nonce: '', ciphertext: 'example.com' } };
    const entries = [...history, password, visit('javascript:alert(1)', 'Example', 100),
      visit('https://user:secret@example.com', 'Example', 101)];
    expect(addressSuggestions(entries, '')).toEqual(history.toReversed().slice(0, MAX_ADDRESS_SUGGESTIONS));
    expect(addressSuggestions(entries, 'secret')).toEqual([]);
  });
});
