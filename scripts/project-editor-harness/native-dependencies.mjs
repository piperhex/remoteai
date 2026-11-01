import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';

/** Reuse the exact dependency fingerprints of the tested crate, including Cargo feature variants. */
export function nativeDependencies(root, artifact) {
  const suffix = basename(artifact.path).match(/^codex_switch_lib_tests-([a-f0-9]+)\.exe$/)?.[1];
  if (!suffix) throw new Error('Record the real desktop test executable before building the native host');
  const target = resolve(root, 'apps/desktop/src-tauri/target/debug');
  const fingerprints = resolve(target, '.fingerprint');
  const tested = readFileSync(resolve(fingerprints, `csw-${suffix}`,
    'test-integration-test-codex_switch_lib_tests.json'), 'utf8');
  // Cargo serializes u64 hashes as JSON numbers; parsing them as JS Numbers loses identity bits.
  const dependencies = new Map([...tested.matchAll(/\[\d+,"([^"]+)",(?:true|false),(\d+)\]/g)]
    .map(match => [match[1], BigInt(match[2])]));
  const directories = readdirSync(fingerprints);
  return ['tauri', 'serde', 'serde_json', 'base64', 'sha2', 'tempfile', 'thiserror', 'uuid'].map(crate => {
    const hash = dependencies.get(crate);
    if (hash === undefined) throw new Error(`Missing tested dependency: ${crate}`);
    const bytes = Buffer.alloc(8);
    bytes.writeBigUInt64LE(hash);
    const expected = bytes.toString('hex');
    const directory = directories.find(name => {
      if (!name.startsWith(`${crate}-`)) return false;
      const fingerprint = resolve(fingerprints, name, `lib-${crate}`);
      const library = resolve(target, 'deps', `lib${name}.rlib`);
      return existsSync(fingerprint) && existsSync(library)
        && readFileSync(fingerprint, 'utf8').trim() === expected;
    });
    if (!directory) throw new Error(`No compiled library matches the tested fingerprint: ${crate}`);
    return { crate, library: resolve(target, 'deps', `lib${directory}.rlib`), fingerprint: expected };
  });
}
