import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { directory, run } from './common.mjs';

// Node 20 and 22 differ on directory arguments; enumerate exact files without shell glob expansion.
const tests = readdirSync(join(directory, 'test')).filter(name => name.endsWith('.test.mjs'));
run(process.execPath, ['--test', ...tests.map(name => join(directory, 'test', name))]);
