import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Independent applications generate and validate their own pinned platform resources. */
export function withHostManifest(root, run) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'packages/i18n/platform.json'), 'utf8'));
  const ownedByHost = entry => !entry.target.startsWith('apps/native/');
  manifest.mirrors = (manifest.mirrors ?? []).filter(ownedByHost);
  manifest.sections = (manifest.sections ?? []).filter(ownedByHost);
  manifest.ownership = {
    ...manifest.ownership,
    include: manifest.ownership?.include ?? ['apps', 'shared', 'scripts'],
    exclude: [...new Set([...(manifest.ownership?.exclude ?? ['apps/admin']), 'apps/native', 'apps/web'])],
  };
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'remoteai-host-i18n-'));
  const filename = path.join(temporary, 'platform.json');
  try {
    fs.writeFileSync(filename, JSON.stringify(manifest, null, 2) + '\n');
    return run(filename);
  } finally {
    // Only remove the private directory allocated by this invocation.
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
