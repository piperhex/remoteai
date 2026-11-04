import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const child = path.join(root, 'packages/i18n');
const command = process.argv[2];
if (!['generate', 'check', 'check-host'].includes(command)) {
  throw new Error('Use npm run generate:i18n or npm run check:i18n.');
}
if (!fs.existsSync(path.join(child, 'scripts/cli.mjs'))) {
  throw new Error('Initialize the language package: git submodule update --init packages/i18n');
}
const run = args => execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
const cli = (action, ...args) => run([path.join(child, 'scripts/cli.mjs'), action, ...args]);

if (command === 'generate') {
  cli('generate');
  cli('integrate', '--root', root);
} else {
  if (command === 'check') {
    if (!process.env.npm_execpath) throw new Error('Run this check through npm run check:i18n.');
    run([process.env.npm_execpath, 'run', 'check', '--workspace', '@remoteai/i18n']);
  }
  cli('integrate', '--root', root, '--check');
  cli('scan', '--root', root);
}
