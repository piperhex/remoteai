import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const gitEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const gitBufferLimit = 64 * 1024 * 1024;
const pathKey = value => process.platform === 'win32' ? value.toLowerCase() : value;

export function git(root, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: root, env: gitEnvironment, encoding: 'utf8', windowsHide: true,
    maxBuffer: gitBufferLimit, input: options.input,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !(options.allowMissing && result.status === 1)) {
    throw new Error(result.stderr.trim() || `Git failed (${result.status}): ${args[0]}`);
  }
  return result.stdout;
}

export function assertRepository(root) {
  const actual = git(root, ['rev-parse', '--show-toplevel']).trim();
  if (pathKey(realpathSync(actual)) !== pathKey(realpathSync(root))) {
    throw new Error(`Expected a repository root: ${root}`);
  }
}

export function trackedPaths(root) {
  const indexed = git(root, ['ls-files', '--cached', '-z']);
  const head = git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], { allowMissing: true });
  // HEAD also protects files removed from the index but still present on disk.
  const committed = head ? git(root, ['ls-tree', '-r', '--name-only', '-z', 'HEAD']) : '';
  const protectedPaths = new Set();
  for (const file of `${indexed}${committed}`.split('\0').filter(Boolean)) {
    const parts = file.split('/');
    while (parts.length) {
      protectedPaths.add(pathKey(parts.join('/')));
      parts.pop();
    }
  }
  return protectedPaths;
}

export function ignoredPaths(root, candidates) {
  if (!candidates.length) return new Set();
  const output = git(root, ['check-ignore', '--no-index', '-z', '--stdin'], {
    input: `${candidates.join('\0')}\0`, allowMissing: true,
  });
  return new Set(output.split('\0').filter(Boolean));
}

export function containedPath(root, candidate) {
  const absolute = resolve(root, candidate);
  const local = relative(root, absolute);
  if (!local || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    throw new Error(`Refusing a path outside the cleanup root: ${candidate}`);
  }
  return absolute;
}

export function safePath(root, candidate) {
  const absolute = containedPath(root, candidate);
  let current = root;
  for (const part of relative(root, absolute).split(sep)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) return false;
    const actual = realpathSync(current);
    containedPath(root, actual);
  }
  return true;
}

function repositoryMarker(entries) {
  const names = new Set(entries.map(entry => entry.name.toLowerCase()));
  if (names.has('.git')) return true;
  return names.has('head') && names.has('objects') && names.has('refs');
}

function inspectTree(root, candidate, skipped) {
  const absolute = containedPath(root, candidate);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) {
    skipped.push({ path: candidate, reason: 'directory link or symbolic link' });
    return [];
  }
  if (!stat.isDirectory()) return [candidate];
  const entries = readdirSync(absolute, { withFileTypes: true });
  if (repositoryMarker(entries)) {
    skipped.push({ path: candidate, reason: 'nested Git repository or worktree' });
    return [];
  }
  const before = skipped.length;
  const children = entries.flatMap(entry => {
    const child = join(candidate, entry.name);
    return entry.isFile() ? [child] : inspectTree(root, child, skipped);
  });
  return skipped.length === before ? [candidate] : children;
}

export function planCleanup(root, candidates) {
  assertRepository(root);
  const tracked = trackedPaths(root);
  const ignored = ignoredPaths(root, candidates);
  const plan = { root, paths: [], skipped: [] };
  for (const candidate of [...new Set(candidates)]) {
    const absolute = containedPath(root, candidate);
    // lstat sees broken symlinks, unlike existsSync.
    if (!existsSync(dirname(absolute))) continue;
    if (!lstatSync(absolute, { throwIfNoEntry: false })) continue;
    let reason;
    if (!safePath(root, candidate)) reason = 'directory link or symbolic link';
    else if (tracked.has(pathKey(candidate))) reason = 'contains tracked files';
    else if (!ignored.has(candidate)) reason = 'not ignored by Git';
    if (reason) plan.skipped.push({ path: candidate, reason });
    else plan.paths.push(...inspectTree(root, candidate, plan.skipped));
  }
  return plan;
}

export function removePlannedPath(root, candidate) {
  // Recheck the absolute destination immediately before each recursive removal.
  const absolute = containedPath(root, candidate);
  if (!safePath(root, candidate)) throw new Error(`Cleanup path became a link: ${candidate}`);
  rmSync(absolute, { recursive: true, maxRetries: 2, retryDelay: 100 });
}
