import type { ProjectDirectoriesResponse, ProjectDirectory } from '../../../shared/remote-chat/projectDirectories';
import type { EntryRequest } from '../../../shared/project-browser/entryActions';

export const explorerRoot = 'D:/jiutian-projects/backend/zczd-wms-b';
export const explorerShortcuts = {
  home: 'C:/Users/RemoteUser', desktop: 'D:/Cloud/Desktop', downloads: 'D:/Downloads',
};
const folders = ['.git', '.idea', '.qoder', '.trae', '.workbuddy', 'doc', 'docs', 'logs', 'reports',
  'scripts', 'sql', 'target', 'tools', 'wms-api', 'wms-biz'];
const entries: ProjectDirectory[] = folders.map((name, index) => ({ name, path: `${explorerRoot}/${name}`,
  directory: true, modified: 1793268120 - index * 86400, size: null }));
entries.push(...['.gitignore', 'pom.xml', 'README.md', 'start-dev.bat'].map((name, index) => ({
  name, path: `${explorerRoot}/${name}`, directory: false, modified: 1793268120, size: [280, 1876, 7230, 1200][index],
})));
const directories = new Map<string, ProjectDirectory[]>([
  ...Object.values(explorerShortcuts).map(path => [path, []] as [string, ProjectDirectory[]]),
  ['', ['C:/', 'D:/'].map(path => ({ name: path, path, directory: true }))],
  ['C:/', [{ name: 'Users', path: 'C:/Users', directory: true }]],
  ['D:/', [{ name: 'jiutian-projects', path: 'D:/jiutian-projects', directory: true }]],
  ['D:/jiutian-projects', [{ name: 'backend', path: 'D:/jiutian-projects/backend', directory: true }]],
  ['D:/jiutian-projects/backend', [{ name: 'zczd-wms-b', path: explorerRoot, directory: true }]],
  [explorerRoot, entries], ...folders.map(name => [`${explorerRoot}/${name}`, []] as [string, ProjectDirectory[]]),
]);
export const explorerCalls: object[] = [];
function parent(path: string) { return /^[a-z]:\/$/i.test(path) ? '' : path.slice(0, path.lastIndexOf('/')) + (/^[a-z]:\/[^/]+$/i.test(path) ? '/' : ''); }

async function listing(directory: string, includeFiles: boolean): Promise<ProjectDirectoriesResponse> {
  if (directory.endsWith('/slow')) await new Promise(resolve => setTimeout(resolve, 500));
  const value = directories.get(directory);
  if (!value) throw new Error('unavailable');
  return { directory, parent: directory ? parent(directory) : null,
    shortcuts: directory ? undefined : explorerShortcuts,
    entries: value.filter(entry => includeFiles || entry.directory), truncated: false };
}

function mutate(request: EntryRequest) {
  const source = directories.get(parent(request.path));
  const entry = source?.find(item => item.path === request.path);
  if (request.action === 'createFile' || request.action === 'createFolder') {
    const path = `${request.path}/${request.name}`;
    if (directories.get(request.path)?.some(item => item.path === path)) throw new Error('exists');
    const directory = request.action === 'createFolder';
    directories.get(request.path)?.push({ name: request.name, path, directory, modified: 1793268120, size: 0 });
    if (directory) directories.set(path, []);
    return { path, directory };
  }
  if (!entry || !source) throw new Error('missing');
  if (request.action === 'delete') source.splice(source.indexOf(entry), 1);
  if (request.action === 'rename') { entry.name = request.name; entry.path = `${parent(entry.path)}/${request.name}`; }
  if (request.action === 'copy' || request.action === 'move') {
    const target = { ...entry, path: `${request.directory}/${entry.name}` };
    directories.get(request.directory)?.push(target);
    if (request.action === 'move') source.splice(source.indexOf(entry), 1);
    if (entry.directory) directories.set(target.path, []);
  }
  return { path: entry.path, directory: entry.directory };
}

export async function explorerRequest<T>(request: object): Promise<T> {
  explorerCalls.push(request);
  const fields = request as { operation: string; directory: string; includeFiles: boolean; cwd: string };
  let result: unknown;
  if (fields.operation === 'projectDirectories') result = await listing(fields.directory, fields.includeFiles);
  if (fields.operation === 'guiProjects') result = [{ cwd: explorerRoot, label: 'zczd-wms-b' }];
  if (fields.operation === 'guiProjectSelect') result = { cwd: fields.cwd, label: fields.cwd.split('/').at(-1) };
  if (fields.operation === 'projectEntryAction') result = mutate(request as EntryRequest);
  return result as T;
}
