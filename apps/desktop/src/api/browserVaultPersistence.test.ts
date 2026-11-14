import { afterEach, expect, it, vi } from 'vitest';
import { PasswordVault } from '../../../../shared/browser/data/vault';
import { BrowserDataStore } from '../../../../shared/browser/data/store';
import { browserRandom, deriveVaultKey } from '../../../../shared/browser/data/crypto';
import { serializeVaultKeyStorage, type RememberedVaultKey } from '../../../../shared/browser/data/vaultKeyStorage';

const stops: (() => void)[] = [];
afterEach(() => { stops.splice(0).forEach(stop => stop()); vi.useRealTimers(); });
function fixture() {
  let saved: RememberedVaultKey | undefined;
  const adapter = serializeVaultKeyStorage({ read: async () => saved, write: async value => { saved = value; },
    remove: async () => { saved = undefined; } });
  const store = new BrowserDataStore('guest');
  const create = () => new PasswordVault(store, browserRandom, undefined, adapter);
  return { adapter, store, create };
}
const login = { origin: 'https://example.test', username: 'alice', password: 'test-secret' };

it('remembers a verified key across remounts without idle locking, and forgets on explicit lock', async () => {
  const { create, adapter } = fixture(), first = create();
  const stop = first.start();
  await first.unlock('long fixture passphrase'); first.save(login);
  vi.useFakeTimers(); await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
  expect(first.snapshot().unlocked).toBe(true); vi.useRealTimers();
  stop(); expect(first.snapshot().unlocked).toBe(false);
  const second = create(); stops.push(second.start());
  await vi.waitFor(() => expect(second.snapshot().entries[0]?.password).toBe(login.password));
  await second.lock(); expect(await adapter.read()).toBeUndefined();
  const third = create(); stops.push(third.start());
  await adapter.read(); expect(third.snapshot().unlocked).toBe(false);
}, 20000);

it('rejects corrupt remembered keys and does not remember an incorrect passphrase', async () => {
  const { create, adapter } = fixture(), first = create();
  await first.unlock('long fixture passphrase');
  const saved = (await adapter.read())!;
  await first.lock(); await adapter.write({ ...saved, key: '00'.repeat(32) });
  const second = create(); stops.push(second.start());
  await adapter.read(); expect(second.snapshot().unlocked).toBe(false);
  await second.lock();
  await expect(second.unlock('wrong password')).rejects.toThrow();
  expect(await adapter.read()).toBeUndefined();
}, 20000);

it('an explicit lock cancels slow derivation before it can remember or unlock the vault', async () => {
  const { store, adapter } = fixture();
  let resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const vault = new PasswordVault(store, browserRandom, async (passphrase, salt) => {
    await gate; return deriveVaultKey(passphrase, salt);
  }, adapter);
  const unlocking = vault.unlock('long fixture passphrase');
  await vault.lock(); resume(); await unlocking;
  expect(vault.snapshot().unlocked).toBe(false); expect(await adapter.read()).toBeUndefined();
}, 20000);

it('serializes an in-flight persistence write before an explicit lock and subsequent restoration', async () => {
  const { create, store } = fixture(), seed = create();
  await seed.unlock('long fixture passphrase');
  let saved: RememberedVaultKey | undefined, resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const write = vi.fn(async (value: RememberedVaultKey) => { await gate; saved = value; });
  const adapter = serializeVaultKeyStorage({ read: async () => saved, write, remove: async () => { saved = undefined; } });
  const vault = new PasswordVault(store, browserRandom, undefined, adapter);
  const unlocking = vault.unlock('long fixture passphrase');
  await vi.waitFor(() => expect(write).toHaveBeenCalled());
  const locking = vault.lock(); resume(); await Promise.all([unlocking, locking]);
  const next = new PasswordVault(store, browserRandom, undefined, adapter); stops.push(next.start());
  await adapter.read(); expect(next.snapshot().unlocked).toBe(false); expect(saved).toBeUndefined();
}, 20000);
