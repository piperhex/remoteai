import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'piperhex/remoteai-native';
const API = 'https://api.github.com';
const UPLOADS = 'https://uploads.github.com';
const MANIFEST = 'native-release.json';
const CHECKSUMS = 'native-SHA256SUMS';
const IOS = 'RemoteAI-ios-unsigned.app.zip';
const STABLE_TAG = /^v\d+\.\d+\.\d+$/;
const MAX_ASSET_BYTES = 512 * 1024 * 1024;
const DOWNLOAD_HOSTS = new Set([
  'api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com',
]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function positiveId(value) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
    throw new Error(`Invalid GitHub ID: ${value}`);
  }
  return Number(value);
}

function uniqueAsset(assets, name, required = true) {
  const matches = assets.filter(asset => asset.name === name);
  if (matches.length > 1 || (required && matches.length !== 1)) {
    throw new Error(`Expected one ${name} asset, found ${matches.length}.`);
  }
  const asset = matches[0];
  if (asset && (asset.state !== 'uploaded' || !Number.isSafeInteger(asset.size) || asset.size <= 0)) {
    throw new Error(`${name} is not completely uploaded; inspect the release before retrying.`);
  }
  return asset;
}

function githubClient(token, fetchImpl) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'remoteai-native-release-mirror',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  async function json(path, options = {}) {
    const response = await fetchImpl(`${API}${path}`, {
      ...options, headers, redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GitHub ${path}: HTTP ${response.status}.`);
    return response.json();
  }
  async function assets(repository, releaseId) {
    const result = [];
    for (let page = 1; ; page++) {
      const path = `/repos/${repository}/releases/${positiveId(releaseId)}/assets`;
      const batch = await json(`${path}?per_page=100&page=${page}`);
      result.push(...batch);
      if (batch.length < 100) return result;
    }
  }
  async function download(repository, asset, maximum = MAX_ASSET_BYTES) {
    if (asset.size > maximum) throw new Error(`${asset.name} exceeds the download limit.`);
    const url = `${API}/repos/${repository}/releases/assets/${positiveId(asset.id)}`;
    const response = await downloadResponse({
      fetchImpl, url, headers: { ...headers, Accept: 'application/octet-stream' },
    });
    const bytes = await readBytes(response, maximum);
    if (bytes.length !== asset.size) throw new Error(`Size mismatch for ${asset.name}.`);
    if (asset.digest && asset.digest !== `sha256:${hash(bytes)}`) {
      throw new Error(`GitHub digest mismatch for ${asset.name}.`);
    }
    return bytes;
  }
  async function upload(repository, releaseId, file) {
    const url = new URL(`${UPLOADS}/repos/${repository}/releases/${releaseId}/assets`);
    url.searchParams.set('name', file.name);
    const response = await fetchImpl(url.href, {
      method: 'POST', redirect: 'error', body: file.bytes, signal: AbortSignal.timeout(600_000),
      headers: { ...headers, 'Content-Type': file.contentType, 'Content-Length': String(file.bytes.length) },
    });
    if (!response.ok) throw new Error(`Upload ${file.name}: HTTP ${response.status}; rerun to resume.`);
    const asset = await response.json();
    await verifyExisting({ client: { download }, repository, asset, file });
  }
  return { json, assets, download, upload };
}

async function downloadResponse({ fetchImpl, url, headers }) {
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetchImpl(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(600_000) });
    if (response.ok) return response;
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      throw new Error(`Release asset download: HTTP ${response.status}.`);
    }
    await response.body?.cancel();
    const location = response.headers.get('location');
    if (!location) throw new Error('Release asset redirect has no location.');
    const next = new URL(location, url);
    if (next.protocol !== 'https:' || !DOWNLOAD_HOSTS.has(next.hostname) || next.username || next.password) {
      throw new Error('Untrusted release asset redirect.');
    }
    url = next.href;
    // Signed CDN redirects need no credentials. Never forward the repository token.
    headers = { Accept: 'application/octet-stream' };
  }
  throw new Error('Too many release asset redirects.');
}

async function readBytes(response, maximum) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maximum) throw new Error('Release asset exceeds the download limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseChecksums(bytes) {
  const entries = new Map();
  for (const line of bytes.toString('utf8').trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64}) [ *]([^/\\]+)$/i.exec(line);
    if (!match || entries.has(match[2])) throw new Error('Invalid or duplicate Native SHA256SUMS entry.');
    entries.set(match[2], match[1].toLowerCase());
  }
  return entries;
}

async function sourceRelease({ client, targetAssets, repository, nativeTag }) {
  const existing = uniqueAsset(targetAssets, MANIFEST, false);
  let pinned;
  if (existing) {
    pinned = JSON.parse((await client.download(repository, existing, 64 * 1024)).toString('utf8'));
    if (pinned.schema !== 1 || pinned.repository !== SOURCE || !STABLE_TAG.test(pinned.tag)) {
      throw new Error('Invalid existing native-release.json.');
    }
    if (nativeTag && pinned.tag !== nativeTag) throw new Error(`This release already pins Native ${pinned.tag}.`);
  }
  const requested = nativeTag ? `tags/${nativeTag}` : 'latest';
  const selector = pinned ? positiveId(pinned.releaseId) : requested;
  const release = await client.json(`/repos/${SOURCE}/releases/${selector}`).catch(error => {
    throw new Error(`Publish a stable Native release with APK, iOS archive and SHA256SUMS first. ${error.message}`);
  });
  if (release.draft || release.prerelease || !release.published_at || !STABLE_TAG.test(release.tag_name)) {
    throw new Error('Native source must be a published stable release.');
  }
  if ((pinned && pinned.tag !== release.tag_name) || (nativeTag && nativeTag !== release.tag_name)) {
    throw new Error('Native release tag changed unexpectedly.');
  }
  return release;
}

async function prepareFiles(client, release) {
  const assets = await client.assets(SOURCE, release.id);
  const checksums = await client.download(SOURCE, uniqueAsset(assets, 'SHA256SUMS'), 64 * 1024);
  const expected = parseChecksums(checksums);
  const files = [];
  for (const name of [`RemoteAI-android-${release.tag_name}.apk`, IOS]) {
    if (!expected.has(name)) throw new Error(`Native SHA256SUMS is missing ${name}.`);
    const bytes = await client.download(SOURCE, uniqueAsset(assets, name));
    if (hash(bytes) !== expected.get(name)) throw new Error(`SHA256SUMS mismatch for ${name}.`);
    const contentType = name.endsWith('.apk') ? 'application/vnd.android.package-archive' : 'application/zip';
    files.push({ name, bytes, contentType });
  }
  const manifest = {
    schema: 1, repository: SOURCE, releaseId: positiveId(release.id), tag: release.tag_name,
    assets: files.map(file => ({ name: file.name, size: file.bytes.length, sha256: hash(file.bytes) })),
  };
  return [
    { name: MANIFEST, bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), contentType: 'application/json' },
    ...files,
    { name: CHECKSUMS, bytes: checksums, contentType: 'text/plain' },
  ];
}

async function verifyExisting({ client, repository, asset, file }) {
  if (asset.state !== 'uploaded' || asset.size !== file.bytes.length) {
    throw new Error(`Existing ${file.name} differs from Native; refusing to replace release assets.`);
  }
  const digest = asset.digest || `sha256:${hash(await client.download(repository, asset))}`;
  if (digest !== `sha256:${hash(file.bytes)}`) {
    throw new Error(`Existing ${file.name} differs from Native; refusing to replace release assets.`);
  }
}

async function missingFiles({ client, repository, targetAssets, files }) {
  const names = new Set(files.map(file => file.name));
  const conflict = targetAssets.find(asset => /\.apk$|-ios-unsigned\.app\.zip$/i.test(asset.name)
    && !names.has(asset.name));
  if (conflict) throw new Error(`Existing mobile asset ${conflict.name} conflicts; historical releases are preserved.`);
  const missing = [];
  for (const file of files) {
    const existing = uniqueAsset(targetAssets, file.name, false);
    if (existing) await verifyExisting({ client, repository, asset: existing, file });
    else missing.push(file);
  }
  return missing;
}

export async function syncNativeRelease(options) {
  const { token, repository, releaseId, tag, nativeTag = '', fetchImpl = fetch, log = console.log } = options;
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !tag) throw new Error('Missing release configuration.');
  if (repository === SOURCE) throw new Error('Native artifacts must be mirrored into a different repository.');
  if (nativeTag && !STABLE_TAG.test(nativeTag)) throw new Error('NATIVE_RELEASE_TAG must be a stable vX.Y.Z tag.');
  const client = githubClient(token, fetchImpl);
  const target = await client.json(`/repos/${repository}/releases/${positiveId(releaseId)}`);
  if (target.tag_name !== tag) throw new Error(`Target release tag ${target.tag_name} does not match ${tag}.`);
  const targetAssets = await client.assets(repository, releaseId);
  const release = await sourceRelease({ client, targetAssets, repository, nativeTag });
  const files = await prepareFiles(client, release);
  const missing = await missingFiles({ client, repository, targetAssets, files });
  // Pin the selected source before large uploads; retries resume this version even if latest changes.
  for (const file of missing) {
    await client.upload(repository, positiveId(releaseId), file);
    log(`Mirrored ${file.name} from ${SOURCE} ${release.tag_name}.`);
  }
  const reused = files.length - missing.length;
  log(`Native ${release.tag_name}: ${missing.length} assets uploaded, ${reused} verified existing.`);
  return { nativeTag: release.tag_name, uploaded: missing.map(file => file.name) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  syncNativeRelease({
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
    releaseId: process.env.RELEASE_ID,
    tag: process.env.TAG_NAME,
    nativeTag: process.env.NATIVE_RELEASE_TAG?.trim(),
  }).catch(error => {
    console.error(`Native release synchronization failed: ${error.message}`);
    process.exitCode = 1;
  });
}
