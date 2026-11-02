// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { searchLoungeHistory } from '../../../../shared/lounge/history';
import { browserAvatarStore } from '../../../../shared/lounge/avatar';
import { parseMessage, type LoungeMessage } from '../../../../shared/lounge/types';

const message = (id: string, text: string): LoungeMessage => ({ type: 'message', id, text,
  sender: { id: 'bob', account: 'Bob@example.test' }, images: [], sentAt: '2026-10-28T04:00:00Z' });

describe('local lounge history', () => {
  it('searches content and accounts together, normalizes case and width, and shows newest first', () => {
    const messages = [message('one', '喝杯咖啡 ☕'), message('two', 'HELLO 😀'), message('three', 'hello again')];
    expect(searchLoungeHistory(messages, 'ＢＯＢ hello').map(item => item.id)).toEqual(['three', 'two']);
    expect(searchLoungeHistory(messages, '咖啡')).toEqual([messages[0]]);
    expect(searchLoungeHistory(messages, 'no match')).toEqual([]);
    expect(searchLoungeHistory(messages, '').map(item => item.id)).toEqual(['three', 'two', 'one']);
    expect(messages[0].id).toBe('one');
  });
  it('keeps avatar preferences separate by account and server, and retains reset markers', () => {
    localStorage.clear();
    const store = browserAvatarStore('https://one.test/');
    const avatar = 'data:image/png;base64,AAAA';
    store.save('alice', avatar);
    expect(browserAvatarStore('https://one.test').load('alice')).toBe(avatar);
    expect(store.load('bob')).toBeUndefined();
    expect(browserAvatarStore('https://two.test').load('alice')).toBeUndefined();
    store.save('alice', ''); expect(store.load('alice')).toBe('');
  });
  it('discards remote avatar URLs while preserving the received message', () => {
    const input = message('safe', 'content'); input.sender.avatar = 'https://tracking.example/avatar';
    const parsed = parseMessage(input);
    expect(parsed?.text).toBe('content');
    expect(parsed?.sender.avatar).toBeUndefined();
  });
});
