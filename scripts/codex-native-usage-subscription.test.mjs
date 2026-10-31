import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL(
  '../apps/desktop/src-tauri/src/dream_skin_native/native_usage_subscription.js', import.meta.url), 'utf8');
const drain = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };

function setup() {
  const resources = [];
  const hosts = [];
  const threads = [];
  const changes = [];
  let now = 0;
  let available = true;
  let loads = 0;
  const resource = () => {
    const result = { released: false, broken: null,
      [Symbol.dispose]() { this.released = true; },
      onRpcBroken(callback) { this.broken = callback; },
    };
    resources.push(result); return result;
  };
  const service = { subscribe(hostId, listener) {
    assert.equal(hostId, 'local'); hosts.push(listener); return resource();
  } };
  const factory = runInNewContext(`${source}\ncreateNativeUsageSubscription`, { Symbol, URL, Date: { now: () => now } });
  const subscription = factory({ onChange: id => changes.push(id), loadService: async () => {
    loads++; return available ? service : null;
  } });
  const ready = (index = hosts.length - 1) => hosts[index]({ status: 'ready', manager: { dup() {
    const manager = resource();
    manager.subscribe = options => {
      assert.equal(options.type, 'thread'); assert.equal(options.field, 'tokenUsageInfo');
      assert.equal(options.key.hostId, 'local'); threads.push(options); return resource();
    };
    return manager;
  } } });
  return { subscription, resources, hosts, threads, changes, ready,
    get loads() { return loads; }, setAvailable(value) { available = value; }, setNow(value) { now = value; } };
}

test('subscribes only to token usage for the selected local conversation and releases resources', async () => {
  const h = setup(); h.subscription.select('one'); await drain(); h.ready();
  const usage = { total: { inputTokens: 1000, cachedInputTokens: 500 } };
  h.threads[0].listener(usage);
  assert.equal(h.subscription.get('one'), usage);
  assert.equal(h.subscription.get('two'), null);
  assert.equal(h.subscription.supported, true);
  h.subscription.select('one'); await drain();
  assert.equal(h.loads, 1);
  assert.deepEqual(h.changes, ['one']);
  h.subscription.dispose();
  assert.ok(h.resources.every(resource => resource.released));
});

test('ignores late callbacks after switching conversations, clearing a draft or disposal', async () => {
  const h = setup(); h.subscription.select('one'); await drain(); h.ready();
  const old = h.threads[0];
  h.subscription.select('two'); await drain(); h.ready();
  old.listener({ total: { inputTokens: 999 } });
  assert.equal(h.subscription.get('two'), null);
  h.threads[1].listener({ total: { inputTokens: 200 } });
  assert.equal(h.subscription.get('two').total.inputTokens, 200);
  h.subscription.select(null);
  h.threads[1].listener({ total: { inputTokens: 999 } });
  assert.equal(h.subscription.get('two'), null);
  h.subscription.dispose(); h.subscription.select('three'); await drain();
  assert.equal(h.loads, 2);
  assert.ok(h.resources.every(resource => resource.released));
});

test('clears disconnected snapshots and rebinds to the replacement manager', async () => {
  const h = setup(); h.subscription.select('one'); await drain(); h.ready();
  const old = h.threads[0]; old.listener({ total: { inputTokens: 100 } });
  h.hosts[0]({ status: 'disconnected' });
  assert.equal(h.subscription.get('one'), null);
  assert.ok(h.resources.slice(1).every(resource => resource.released));
  h.ready(); old.listener({ total: { inputTokens: 999 } });
  assert.equal(h.subscription.get('one'), null);
  h.threads[1].listener({ total: { inputTokens: 200 } });
  assert.equal(h.subscription.get('one').total.inputTokens, 200);
  h.subscription.dispose();
});

test('retries missing or broken services after a delay without overlapping subscriptions', async () => {
  const h = setup(); h.setAvailable(false); h.subscription.select('one'); await drain();
  for (let index = 0; index < 5; index++) h.subscription.select('one');
  assert.equal(h.loads, 1);
  h.setAvailable(true); h.setNow(5000); h.subscription.select('one'); await drain(); h.ready();
  h.resources.at(-1).broken();
  assert.ok(h.resources.every(resource => resource.released));
  h.subscription.select('one'); assert.equal(h.loads, 2);
  h.setNow(10000); h.subscription.select('one'); await drain(); h.ready();
  assert.equal(h.loads, 3); h.subscription.dispose();
});

test('disposes leases that finish resolving after the conversation has changed', async () => {
  let resolveLease;
  const pending = new Promise(resolve => { resolveLease = resolve; });
  pending[Symbol.dispose] = () => {};
  const factory = runInNewContext(`${source}\ncreateNativeUsageSubscription`, { Symbol, URL, Date });
  const subscription = factory({ onChange() {}, loadService: async () => ({ subscribe: () => pending }) });
  subscription.select('one'); await drain(); subscription.select(null);
  let released = false;
  resolveLease({ [Symbol.dispose]() { released = true; } }); await drain();
  assert.equal(released, true); subscription.dispose();
});
