import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function extractVerifiedWindowsZip(archive, destination) {
  await mkdir(destination, { recursive: true });
  const tar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  const result = spawnSync(tar, ['-xf', archive, '-C', destination], {
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Verified Windows ZIP extraction failed');
}
