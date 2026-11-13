import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserDataChannel } from '../../../../shared/browser/data/channel';
import { BrowserDataStore } from '../../../../shared/browser/data/store';
import { PasswordVault } from '../../../../shared/browser/data/vault';
import { browserRandom } from '../../../../shared/browser/data/crypto';
import { rangeStart, readBrowserDocument, type BrowserDocument, type Visit } from '../../../../shared/browser/data/model';
import { clearBrowserData } from '../../../../shared/browser/data/clear';

const stops: (() => void)[] = [];
afterEach(() => { stops.splice(0).forEach(stop => stop()); vi.useRealTimers(); });
const memory = () => {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
};
const visit = (id: string, at = Date.now()): Visit => ({ id, at, kind: 'visit', title: id, url: `https://example.test/${id}` });
function server() {
  let document: BrowserDocument = { revision: 0, entries: [] };
  const channels: BrowserDataChannel[] = [];
  const connect = () => {
    const channel = new BrowserDataChannel(frame => {
      queueMicrotask(() => {
        const edit = frame.browserData as BrowserDocument | undefined;
        const accepted = !!edit && edit.revision === document.revision;
        if (accepted) document = { revision: document.revision + 1, entries: edit.entries };
        const reply = { type: 'browser-data', id: frame.id, document, accepted };
        channel.receive(reply);
        if (accepted) channels.filter(other => other !== channel).forEach(other => other.receive(reply));
      }); return true;
    }, () => crypto.randomUUID());
    channels.push(channel); channel.ready(true); return channel;
  };
  return { connect, document: () => document };
}

describe('browser account data', () => {
  it('synchronizes concurrent visits, offline edits, deletion and account isolation', async () => {
    const cloud = server(), storage = memory(), firstChannel = cloud.connect();
    const first = new BrowserDataStore('alice', storage, firstChannel);
    const second = new BrowserDataStore('alice', memory(), cloud.connect());
    stops.push(first.start(), second.start());
    await vi.waitFor(() => expect(first.snapshot().status).toBe('synced'));
    first.visit(visit('first')); second.visit(visit('second'));
    await vi.waitFor(() => expect(cloud.document().entries).toHaveLength(2));
    firstChannel.disconnect(); first.visit(visit('offline'));
    second.remove(['first']);
    await vi.waitFor(() => expect(cloud.document().entries).toHaveLength(1));
    firstChannel.ready(true);
    await vi.waitFor(() => expect(second.snapshot().entries.map(entry => entry.id).sort()).toEqual(['offline', 'second']));
    expect(new BrowserDataStore('bob', storage).snapshot().entries).toEqual([]);
    expect(new BrowserDataStore('alice', storage).snapshot().entries).toHaveLength(2);
  });

  it('keeps login values encrypted at rest and in transit, unlocks on a second device, and synchronizes edits', async () => {
    const cloud = server(), storage = memory();
    const first = new BrowserDataStore('a', storage, cloud.connect()), second = new BrowserDataStore('a', memory(), cloud.connect());
    const vault = new PasswordVault(first, browserRandom), other = new PasswordVault(second, browserRandom);
    stops.push(first.start(), second.start(), vault.start(), other.start());
    await vi.waitFor(() => expect(first.snapshot().hydrated).toBe(true));
    await vault.unlock('long test vault phrase');
    vault.save({ origin: 'https://example.test', username: 'private-user', password: 'private-secret' });
    await vi.waitFor(() => expect(second.snapshot().entries).toHaveLength(2));
    const persisted = JSON.stringify([...storage.values.values()]) + JSON.stringify(cloud.document());
    for (const secret of ['private-user', 'private-secret', 'https://example.test']) expect(persisted).not.toContain(secret);
    await expect(other.unlock('the wrong phrase')).rejects.toThrow();
    await other.unlock('long test vault phrase');
    expect(other.snapshot().entries[0].password).toBe('private-secret');
    const id = other.snapshot().entries[0].id;
    other.save({ origin: 'https://example.test', username: 'private-user', password: 'updated-secret' }, id);
    await vi.waitFor(() => expect(vault.snapshot().entries[0].password).toBe('updated-secret'));
    other.remove([id]);
    await vi.waitFor(() => expect(vault.snapshot().entries).toEqual([]));
    vault.lock(); expect(vault.snapshot()).toEqual({ unlocked: false, entries: [], error: false });
  }, 20000);

  it('clears only selected records and requires an unlocked vault before deleting passwords', async () => {
    const now = Date.now(), store = new BrowserDataStore('guest', memory()), vault = new PasswordVault(store, browserRandom);
    store.visit(visit('old', now - 86400000)); store.visit(visit('recent', now));
    const closeTabs = vi.fn(), clearSiteData = vi.fn().mockResolvedValue(undefined);
    const controls = { closeTabs, clearSiteData, tabs: [{ id: 'old', at: now - 86400000 }, { id: 'new', at: now }] };
    await clearBrowserData({ store, vault, controls, categories: ['history', 'tabs'], range: 'hour', now });
    expect(store.snapshot().entries.map(entry => entry.id)).toEqual(['old']);
    expect(closeTabs).toHaveBeenCalledWith(['new']); expect(clearSiteData).not.toHaveBeenCalled();
    await expect(clearBrowserData({ store, vault, controls, categories: ['passwords'], range: 'all' })).rejects.toThrow();
    expect(rangeStart('month', now)).toBe(now - 28 * 86400000);
  });

  it('rejects unsafe URLs, duplicate IDs and orphaned encrypted password records', () => {
    for (const url of ['javascript:alert(1)', 'file:///secret', 'https://user:pass@example.test']) {
      expect(readBrowserDocument({ revision: 0, entries: [{ ...visit('a'), url }] })).toBeUndefined();
    }
    expect(readBrowserDocument({ revision: 0, entries: [visit('a'), visit('a')] })).toBeUndefined();
    expect(readBrowserDocument({ revision: 0, entries: [{ id: 'p', kind: 'password', salt: 'ab'.repeat(16), at: 1,
      secret: { nonce: 'ab'.repeat(12), ciphertext: 'ab'.repeat(16) } }] })).toBeUndefined();
  });

  it('merges independently created offline vaults without losing either device password', async () => {
    const cloud = server(), firstChannel = cloud.connect(), otherChannel = cloud.connect();
    const first = new BrowserDataStore('a', memory(), firstChannel), second = new BrowserDataStore('a', memory(), otherChannel);
    const vault = new PasswordVault(first, browserRandom), other = new PasswordVault(second, browserRandom);
    stops.push(first.start(), second.start(), vault.start(), other.start());
    await vi.waitFor(() => expect(first.snapshot().hydrated && second.snapshot().hydrated).toBe(true));
    const creations = Promise.all([vault.unlock('first vault passphrase'), other.unlock('second vault passphrase')]);
    // Both devices confirmed an empty account before starting derivation, then lost connectivity.
    firstChannel.disconnect(); otherChannel.disconnect(); await creations;
    vault.save({ origin: 'https://first.test', username: 'first', password: 'first-secret' });
    other.save({ origin: 'https://second.test', username: 'second', password: 'second-secret' });
    firstChannel.ready(true);
    await vi.waitFor(() => expect(cloud.document().entries).toHaveLength(2));
    otherChannel.ready(true);
    await vi.waitFor(() => expect(second.snapshot().status).toBe('conflict'));
    expect(other.snapshot().entries[0].password).toBe('second-secret');
    await expect(other.mergeConflict('incorrect passphrase')).rejects.toThrow();
    await other.mergeConflict('first vault passphrase');
    await vi.waitFor(() => expect(vault.snapshot().entries).toHaveLength(2));
    expect(other.snapshot().entries.map(entry => entry.password).sort()).toEqual(['first-secret', 'second-secret']);
    expect(second.snapshot().status).toBe('synced');
  }, 20000);
});
