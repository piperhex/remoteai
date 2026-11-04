import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const registry = JSON.parse(readFileSync(new URL('../shared/coze/runtime.json', import.meta.url), 'utf8'));
assert.equal(registry.protocol, 1);
assert.equal(registry.releaseTag, `coze-v${registry.version}`);
assert.equal(registry.repository, 'piperhex/remoteai-coze');
assert.ok(registry.publicKey?.length > 32, 'Missing Coze signing public key');
const headers = { accept: 'application/vnd.github+json', 'user-agent': 'remoteai-coze-release-check' };
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
const response = await fetch(`https://api.github.com/repos/${registry.repository}/releases/tags/${registry.releaseTag}`,
  { headers, signal: AbortSignal.timeout(30_000) });
assert.ok(response.ok, `Pinned Coze release is unavailable (${response.status})`);
const release = await response.json();
assert.equal(release.draft, false, 'Pinned Coze release is still a draft');
for (const platform of ['windows-x86_64', 'windows-aarch64', 'macos-x86_64', 'macos-aarch64', 'linux-x86_64']) {
  for (const extension of ['zip', 'zip.sig']) {
    const name = `coze-${platform}.${extension}`;
    assert.ok(release.assets.some(asset => asset.name === name && asset.size > 0), `Missing ${name}`);
  }
}
console.log(`Verified published Coze runtime ${registry.releaseTag}`);
