import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { syncNativeRelease } from './sync-native-release.mjs';

const SOURCE = 'piperhex/remoteai-native';
const TARGET = 'piperhex/remoteai';
const API = 'https://api.github.com';
const APK = 'RemoteAI-android-v2.2.1.apk';
const IOS = 'RemoteAI-ios-unsigned.app.zip';
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

function fixture() {
  const state = {
    source: { id: 70, tag_name: 'v2.2.1', draft: false, prerelease: false, published_at: '2026-11-04T12:00:00Z' },
    sourceAssets: [], targetAssets: [], contents: new Map(), uploads: [], calls: [],
    corrupt: null, redirect: null, failUpload: null, noRelease: false, noDigest: false,
  };
  function add(repository, name, content, overrides = {}) {
    const bytes = Buffer.from(content);
    const asset = {
      id: state.contents.size + 1, name, state: 'uploaded', size: bytes.length, digest: digest(bytes), ...overrides,
    };
    state.contents.set(`${repository}/${asset.id}`, bytes);
    (repository === SOURCE ? state.sourceAssets : state.targetAssets).push(asset);
    return asset;
  }
  const apk = add(SOURCE, APK, 'signed APK bytes');
  const ios = add(SOURCE, IOS, 'unsigned iOS archive');
  add(SOURCE, 'SHA256SUMS', `${apk.digest.slice(7)}  ${APK}\n${ios.digest.slice(7)}  ${IOS}\n`);
  add(TARGET, 'RemoteAI_3.0.0_windows-x64-setup.exe', 'desktop installer');
  const fetchImpl = fakeGithub(state, add);
  const run = overrides => syncNativeRelease({
    token: 'test-token', repository: TARGET, releaseId: 80, tag: 'v3.0.0', fetchImpl, log() {}, ...overrides,
  });
  return { state, add, run };
}

function fakeGithub(state, add) {
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    state.calls.push({ url, options });
    if (parsed.host === 'release-assets.githubusercontent.com') {
      assert.equal(options.headers.Authorization, undefined);
      return new Response(state.contents.get(parsed.pathname.slice(1)));
    }
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    if (parsed.host === 'uploads.github.com') return upload(parsed, options);
    assert.equal(parsed.origin, API);
    return api(parsed, options);
  };
  function upload(url, options) {
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(url.pathname, `/repos/${TARGET}/releases/80/assets`);
    const name = url.searchParams.get('name');
    if (name === state.failUpload) return new Response('', { status: 502 });
    state.uploads.push(name);
    return json(add(TARGET, name, options.body, state.noDigest ? { digest: null } : {}));
  }
  function api(url, options) {
    const path = url.pathname;
    if (path === `/repos/${TARGET}/releases/80`) return json({ id: 80, tag_name: 'v3.0.0' });
    if (path === `/repos/${SOURCE}/releases/latest` || path === `/repos/${SOURCE}/releases/tags/v2.2.1`
      || path === `/repos/${SOURCE}/releases/70`) {
      return state.noRelease ? new Response('', { status: 404 }) : json(state.source);
    }
    const match = /^\/repos\/(.+)\/releases\/assets\/(\d+)$/.exec(path);
    if (match) {
      assert.equal(options.headers.Accept, 'application/octet-stream');
      if (state.redirect) return new Response(null, { status: 302, headers: { location: state.redirect(match) } });
      const bytes = state.contents.get(`${match[1]}/${match[2]}`);
      return new Response(state.corrupt === `${match[1]}/${match[2]}` ? Buffer.alloc(bytes.length) : bytes);
    }
    if (path.endsWith('/assets')) return assetPage(state, url);
    throw new Error(`Unexpected request ${url.href}`);
  }
  return fetchImpl;
}

function assetPage(state, url) {
  const page = Number(url.searchParams.get('page'));
  assert.equal(url.searchParams.get('per_page'), '100');
  const assets = url.pathname.includes(SOURCE) ? state.sourceAssets : state.targetAssets;
  return json(assets.slice((page - 1) * 100, page * 100));
}

test('mirrors original Native bytes and versions, checksums and provenance alongside desktop installers', async () => {
  const { state, run } = fixture();
  const result = await run();
  assert.equal(result.nativeTag, 'v2.2.1');
  assert.deepEqual(state.uploads, ['native-release.json', APK, IOS, 'native-SHA256SUMS']);
  assert.equal(state.targetAssets[0].name, 'RemoteAI_3.0.0_windows-x64-setup.exe');
  for (const name of [APK, IOS]) {
    const source = state.sourceAssets.find(asset => asset.name === name);
    const target = state.targetAssets.find(asset => asset.name === name);
    assert.deepEqual(state.contents.get(`${TARGET}/${target.id}`), state.contents.get(`${SOURCE}/${source.id}`));
  }
  const manifestAsset = state.targetAssets.find(asset => asset.name === 'native-release.json');
  const manifest = JSON.parse(state.contents.get(`${TARGET}/${manifestAsset.id}`));
  assert.equal(manifest.repository, SOURCE);
  assert.equal(manifest.tag, 'v2.2.1');
  assert.equal(manifest.releaseId, 70);
  assert.equal(manifest.assets[0].sha256, state.sourceAssets[0].digest.slice(7));
});

test('resumes an interrupted upload from the recorded source without consulting a newer latest release', async () => {
  const { state, run } = fixture();
  state.failUpload = IOS;
  await assert.rejects(run(), /Upload .*HTTP 502/);
  assert.deepEqual(state.uploads, ['native-release.json', APK]);
  state.failUpload = null;
  state.calls = [];
  const result = await run();
  assert.deepEqual(result.uploaded, [IOS, 'native-SHA256SUMS']);
  assert.ok(state.calls.some(call => call.url.endsWith('/releases/70')));
  assert.ok(!state.calls.some(call => call.url.endsWith('/latest')));
  assert.deepEqual((await run()).uploaded, []);
  assert.equal(state.uploads.length, 4);
});

test('allows a stable tag override but refuses to switch an already pinned release', async () => {
  const { state, run } = fixture();
  await run({ nativeTag: 'v2.2.1' });
  assert.ok(state.calls.some(call => call.url.endsWith('/releases/tags/v2.2.1')));
  await assert.rejects(run({ nativeTag: 'v2.2.2' }), /already pins Native v2.2.1/);
  await assert.rejects(run({ nativeTag: 'v2.2.2-beta.1' }), /stable vX.Y.Z/);
});

test('requires a published stable Native release and both mobile packages before writing anything', async () => {
  for (const mutate of [
    state => { state.noRelease = true; },
    state => { state.source.draft = true; },
    state => { state.source.prerelease = true; },
    state => { state.sourceAssets = state.sourceAssets.filter(asset => asset.name !== APK); },
    state => { state.sourceAssets = state.sourceAssets.filter(asset => asset.name !== IOS); },
    state => { state.sourceAssets = state.sourceAssets.filter(asset => asset.name !== 'SHA256SUMS'); },
  ]) {
    const { state, run } = fixture();
    mutate(state);
    await assert.rejects(run(), /Publish a stable|published stable|Expected one/);
    assert.deepEqual(state.uploads, []);
  }
});

test('rejects corrupt bytes, digest mismatches and missing or duplicate checksum entries before uploads', async () => {
  for (const mode of ['checksum', 'digest', 'missing', 'duplicate', 'size']) {
    const { state, run } = fixture();
    const apk = state.sourceAssets[0];
    if (mode === 'digest' || mode === 'checksum') {
      state.corrupt = `${SOURCE}/${apk.id}`;
      if (mode === 'checksum') apk.digest = null;
    } else if (mode === 'size') apk.size++;
    else {
      const checksums = state.sourceAssets.find(asset => asset.name === 'SHA256SUMS');
      const bytes = Buffer.from(mode === 'missing' ? `${apk.digest.slice(7)}  unrelated.apk\n`
        : `${apk.digest.slice(7)}  ${APK}\n`.repeat(2));
      state.contents.set(`${SOURCE}/${checksums.id}`, bytes);
      checksums.size = bytes.length;
      checksums.digest = digest(bytes);
    }
    await assert.rejects(run(), /mismatch|missing|duplicate/);
    assert.deepEqual(state.uploads, []);
  }
});

test('preserves historical, conflicting, duplicate and incomplete assets', async () => {
  for (const mode of ['historical', 'different', 'duplicate', 'incomplete']) {
    const { state, run, add } = fixture();
    if (mode === 'historical') add(TARGET, 'CodexSwitch-android-v2.1.0.apk', 'old package');
    else if (mode === 'different') add(TARGET, APK, 'different bytes!');
    else if (mode === 'incomplete') add(TARGET, APK, '', { state: 'starter' });
    else {
      add(TARGET, APK, 'signed APK bytes');
      add(TARGET, APK, 'signed APK bytes');
    }
    const before = structuredClone(state.targetAssets);
    await assert.rejects(run(), /conflicts|differs|Expected one|not completely uploaded/);
    assert.deepEqual(state.targetAssets, before);
    assert.deepEqual(state.uploads, []);
  }
});

test('downloads existing bytes for verification when GitHub supplies no digest', async () => {
  const { state, run } = fixture();
  state.noDigest = true;
  await run();
  state.calls = [];
  assert.deepEqual((await run()).uploaded, []);
  assert.equal(state.calls.filter(call => call.url.includes(`/repos/${TARGET}/releases/assets/`)).length, 5);
  const apk = state.targetAssets.find(asset => asset.name === APK);
  state.contents.set(`${TARGET}/${apk.id}`, Buffer.alloc(apk.size));
  await assert.rejects(run(), /differs from Native/);
});

test('follows GitHub CDN redirects without forwarding authorization and rejects other hosts', async () => {
  const { state, run } = fixture();
  state.redirect = match => `https://release-assets.githubusercontent.com/${match[1]}/${match[2]}`;
  await run();
  assert.ok(state.calls.some(call => call.url.startsWith('https://release-assets.githubusercontent.com/')));
  state.redirect = () => 'https://untrusted.example/asset';
  await assert.rejects(run(), /Untrusted release asset redirect/);
  assert.ok(!state.calls.some(call => call.url.startsWith('https://untrusted.example/')));
});

test('paginates target assets so a conflicting APK cannot hide after the first page', async () => {
  const { state, run, add } = fixture();
  for (let index = 0; index < 100; index++) add(TARGET, `desktop-${index}.sig`, 'signature');
  add(TARGET, 'RemoteAI-android-v2.1.0.apk', 'old package');
  await assert.rejects(run(), /conflicts/);
  assert.ok(state.calls.some(call => call.url.includes('page=2')));
  assert.deepEqual(state.uploads, []);
});

test('validates the destination release tag and Native tag before mutation', async () => {
  const { state, run } = fixture();
  await assert.rejects(run({ tag: 'v9.0.0' }), /does not match/);
  await assert.rejects(run({ repository: SOURCE }), /different repository/);
  await assert.rejects(run({ releaseId: '../latest' }), /Invalid GitHub ID/);
  assert.deepEqual(state.uploads, []);
});

test('rejects a manifest claiming a different source repository', async () => {
  const { state, run, add } = fixture();
  add(TARGET, 'native-release.json', JSON.stringify({
    schema: 1, repository: 'other/native', releaseId: 70, tag: 'v2.2.1',
  }));
  await assert.rejects(run(), /Invalid existing native-release.json/);
  assert.deepEqual(state.uploads, []);
});

test('rejects changed source artifacts on retry even when the new source checksums match', async () => {
  const { state, run } = fixture();
  await run();
  const apk = state.sourceAssets[0];
  const bytes = Buffer.alloc(apk.size);
  state.contents.set(`${SOURCE}/${apk.id}`, bytes);
  apk.digest = digest(bytes);
  const checksums = state.sourceAssets.find(asset => asset.name === 'SHA256SUMS');
  const sums = Buffer.from(`${apk.digest.slice(7)}  ${APK}\n${state.sourceAssets[1].digest.slice(7)}  ${IOS}\n`);
  checksums.size = sums.length;
  checksums.digest = digest(sums);
  state.contents.set(`${SOURCE}/${checksums.id}`, sums);
  state.uploads = [];
  await assert.rejects(run(), /Existing native-release.json differs/);
  assert.deepEqual(state.uploads, []);
});
