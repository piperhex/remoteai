import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const result = await build({
  entryPoints: [fileURLToPath(new URL('../cli-gui/host.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../src-tauri/resources/cli-gui/host.mjs', import.meta.url)),
  bundle: true, platform: 'node', target: 'node22', format: 'esm', legalComments: 'linked',
  metafile: true,
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
});

const notices = [await readFile(new URL('../cli-gui/PASEO-LICENSE', import.meta.url), 'utf8')];
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes('node_modules/')) continue;
  const parts = input.split('/');
  const index = parts.lastIndexOf('node_modules');
  packages.add(parts.slice(0, index + (parts[index + 1].startsWith('@') ? 3 : 2)).join('/'));
}
for (const directory of packages) {
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const licenses = (await readdir(directory)).filter(name => /^(license|licence|copying|notice)(\.|$)/i.test(name));
  notices.push(`\n${manifest.name}@${manifest.version}\n${manifest.license ?? 'See Paseo license above'}\n`);
  for (const filename of licenses) notices.push(await readFile(join(directory, filename), 'utf8'));
}
await writeFile(new URL('../src-tauri/resources/cli-gui/THIRD-PARTY-NOTICES.txt', import.meta.url), notices.join('\n'));
