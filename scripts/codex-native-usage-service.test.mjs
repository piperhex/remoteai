import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL(
  '../apps/desktop/src-tauri/src/dream_skin_native/native_usage_service.js', import.meta.url), 'utf8');
const service = () => ({ subscribe() {}, openAccount() { throw new Error('Usage must not open an account'); } });
const moduleScript = src => ({ type: 'module', src });

function setup({ links = [], scripts = [] } = {}) {
  let yields = 0;
  const document = { querySelectorAll(selector) {
    return selector.startsWith('link') ? links.map(href => ({ href }))
      : scripts.filter(script => script.type === 'module' && script.src);
  } };
  const load = runInNewContext(`${source}\nloadNativeUsageService`, {
    URL, document, location: new URL('app://-/index.html'),
    setTimeout(callback) { yields++; callback(); },
  });
  return { load, get yields() { return yields; } };
}

test('retains the legacy preloaded service and does not import other entries once found', async () => {
  const h = setup({ links: ['/assets/app-shared-old.js'], scripts: [moduleScript('/assets/123.hash.js')] });
  const expected = service(); const imports = [];
  assert.equal(await h.load(async url => {
    imports.push(url); return { services: { appServerManagers: expected } };
  }), expected);
  assert.deepEqual(imports, ['app://-/assets/app-shared-old.js']);
});

test('reads initialized Rspack cache exports without calling require or module factories', async () => {
  const h = setup({ scripts: [moduleScript('/assets/348410.ae8bb87271.js')] });
  const expected = service(); let callableReads = 0;
  const callable = new Proxy(() => {}, { get() { callableReads++; throw new Error('Callable RPC proxy'); } });
  const blocked = new Proxy({}, { get() { throw new Error('Cross-origin Window'); }, ownKeys() {
    throw new Error('Cross-origin Window');
  } });
  const exports = { blocked, appHost: callable, appServices: { appServerManagers: expected } };
  Object.defineProperty(exports, 'uninitialized', { enumerable: true, get() { throw new Error('Not ready'); } });
  const require = () => { throw new Error('Discovery must not execute modules'); };
  require.m = { unexecuted() { throw new Error('Must not run a factory'); } };
  require.c = { broken: { error: new Error('Failed module'), exports: { appServerManagers: service() } },
    loaded: { exports } };
  assert.equal(await h.load(async () => ({ __webpack_require__: require, __webpack_modules__: require.m })), expected);
  assert.equal(callableReads, 0);
});

test('yields during large cache discovery and keeps the scan bounded', async () => {
  const h = setup({ scripts: [moduleScript('/assets/1.runtime.js')] });
  const expected = service(); const require = () => { throw new Error('No module execution'); };
  require.c = Object.fromEntries(Array.from({ length: 250 }, (_, index) => [index, { exports: {} }]));
  require.c[250] = { exports: { appServerManagers: expected } };
  assert.equal(await h.load(async () => ({ __webpack_require__: require })), expected);
  assert.ok(h.yields > 0);
  require.c = Object.fromEntries(Array.from({ length: 20001 }, (_, index) => [index, { exports: {} }]));
  require.c[20000] = { exports: { appServerManagers: expected } };
  assert.equal(await h.load(async () => ({ __webpack_require__: require })), null);
});

test('imports only same-origin asset modules and excludes classic scripts and foreign preloads', async () => {
  const h = setup({ links: ['https://example.com/assets/app-shared-foreign.js', '/assets/other-preload.js'],
    scripts: [{ type: '', src: '/assets/classic.js' }, moduleScript('https://example.com/assets/module.js'),
      moduleScript('/not-assets/entry.js'), moduleScript('/assets/12.hash.js')] });
  const imports = [];
  assert.equal(await h.load(async url => { imports.push(url); return {}; }), null);
  assert.deepEqual(imports, ['app://-/assets/12.hash.js']);
});

test('continues after a failed entry and deduplicates candidates', async () => {
  const h = setup({ links: ['/assets/app-shared-old.js'], scripts: [
    moduleScript('/assets/working.js'), moduleScript('/assets/broken.js'), moduleScript('/assets/broken.js')] });
  const expected = service(); const imports = [];
  assert.equal(await h.load(async url => {
    imports.push(url); if (!url.endsWith('/working.js')) throw new Error('Unavailable entry');
    return { appServerManagers: expected };
  }), expected);
  assert.deepEqual(imports, ['app://-/assets/app-shared-old.js', 'app://-/assets/broken.js', 'app://-/assets/working.js']);
});

test('limits the number of imported entries and tolerates an empty document', async () => {
  const h = setup({ scripts: Array.from({ length: 20 }, (_, index) => moduleScript(`/assets/${index}.hash.js`)) });
  let imports = 0;
  assert.equal(await h.load(async () => { imports++; return {}; }), null);
  assert.equal(imports, 8);
  assert.equal(await setup().load(async () => { throw new Error('Nothing should be imported'); }), null);
});

test('shares overlapping discovery and retries after missing services or replaced caches', async () => {
  const h = setup({ scripts: [moduleScript('/assets/1.runtime.js')] });
  const expected = service(); let resolve; let imports = 0;
  const pending = new Promise(done => { resolve = done; });
  const importer = async () => { imports++; return pending; };
  const first = h.load(importer); const second = h.load(importer);
  resolve({}); assert.equal(await first, null); assert.equal(await second, null); assert.equal(imports, 1);
  const require = () => { throw new Error('No module execution'); };
  require.c = { loaded: { exports: { appServerManagers: expected } } };
  assert.equal(await h.load(async () => ({ __webpack_require__: require })), expected);
  const replacement = service(); require.c.loaded.exports.appServerManagers = replacement;
  assert.equal(await h.load(async () => ({ __webpack_require__: require })), replacement);
});
