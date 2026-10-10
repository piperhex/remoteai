import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const resourceDirectories = ['resources/desktop-service', 'resources/remote-desktop'];
const requiredFiles = [
  'resources/desktop-service/node.exe',
  'resources/desktop-service/host.mjs',
  'resources/desktop-service/LICENSE.node',
  'resources/remote-desktop/runtime/desktop-video.exe',
  'resources/remote-desktop/runtime/ffmpeg.exe',
  'resources/remote-desktop/runtime/desktop-privacy.exe',
  'resources/remote-desktop/runtime/privacy-driver/MttVDD.inf',
  'resources/remote-desktop/runtime/privacy-driver/MttVDD.dll',
  'resources/remote-desktop/runtime/privacy-driver/mttvdd.cat',
  'resources/remote-desktop/runtime/privacy-driver/LICENSE.txt',
];

function collect(root, relative, entries) {
  for (const name of readdirSync(resolve(root, relative))) {
    const path = `${relative}/${name}`;
    const metadata = lstatSync(resolve(root, path));
    if (metadata.isSymbolicLink()) throw new Error(`Linked service asset: ${path}`);
    if (metadata.isDirectory()) {
      collect(root, path, entries);
      continue;
    }
    entries.set(path, createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex'));
  }
}

/** Check the extracted installer, including the resource hashes embedded before Rust compilation. */
export function verifyWindowsService(root) {
  for (const relative of requiredFiles) {
    const path = resolve(root, relative);
    if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).size === 0) {
      throw new Error(`Missing Windows unattended service asset: ${relative}`);
    }
  }
  const entries = new Map();
  for (const directory of resourceDirectories) collect(root, directory, entries);
  const sorted = Object.fromEntries([...entries].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  const manifest = Buffer.from(JSON.stringify(sorted));
  if (!readFileSync(resolve(root, 'csw.exe')).includes(manifest)) {
    throw new Error('Packaged service resources do not match the manifest embedded in csw.exe');
  }
  return entries.size;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Pass the extracted Windows application directory');
  const count = verifyWindowsService(resolve(process.argv[2]));
  console.log(`Windows unattended service: ${count} packaged assets match the executable manifest.`);
}
