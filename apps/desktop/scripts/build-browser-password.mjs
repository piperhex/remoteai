import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
await import('../../../shared/scripts/build-browser-password.mjs');
const source = fileURLToPath(new URL('../../../shared/browser/data/passwordPage.ts', import.meta.url));
const output = fileURLToPath(new URL('../src-tauri/resources/browser-password.js', import.meta.url));
const result = await build({ entryPoints: [source], bundle: true, write: false, format: 'iife',
  absWorkingDir: fileURLToPath(new URL('../../../shared/', import.meta.url)),
  globalName: 'RemoteAIBrowserPassword', target: 'es2020', legalComments: 'none' });
const text = result.outputFiles[0].text;
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== text) throw new Error('Browser password script needs regeneration');
} else writeFileSync(output, text);
