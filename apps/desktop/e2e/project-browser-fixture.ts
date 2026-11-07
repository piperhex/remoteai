import type { ProjectBlame, ProjectBrowserRequest, ProjectDocument } from '../../../shared/project-browser/protocol';
import type { ProjectFilesResponse } from '../../../shared/remote-chat/projectFiles';
import { mutateFixture } from './project-browser-mutations';
import { fromByteArray, toByteArray } from 'base64-js';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
const FILE_CHUNK_BYTES = 256 * 1024;
const PLAIN_TEXT_THRESHOLD = 5 * 1024 * 1024;

export const browserRoot = 'C:/project';
const documents: Record<string, string> = {
  'src/main.ts': 'export function greet(name: string) {\n  const message = `Hello, ${name}`;\n  return message;\n}\n',
  'notes.txt': 'Project notes\nFind this sentence\nA plain text paragraph\n\nSecond paragraph\nAnother line\n',
  'README.md': '# Project\n\nThis is plain documentation.\n',
  'settings.json': '{\n  "enabled": true,\n  "theme": "dark"\n}\n',
  'docker-compose.yml': 'services:\n' + Array.from({ length: 32 }, (_, index) =>
    `  database${index + 1}:\n    image: mysql:8.0\n    restart: unless-stopped\n`
    + '    environment:\n      MYSQL_DATABASE: sample\n    ports:\n      - "3306"\n').join(''),
  'nested/子目录/测试.py': 'def hello():\n    return "你好"\n',
};
const revisions: Record<string, number> = {};
const directories = new Set(['', 'src', 'nested', 'nested/子目录']);
export const savedFiles: { path: string; text: string }[] = [];
export let conflict = false;
export function causeConflict() { conflict = true; }
export function seedNpmScripts() {
  documents['package.json'] = JSON.stringify({ name: 'npm-fixture', scripts: {
    dev: 'node server.cjs', build: 'node build.cjs', failStart: 'node missing.cjs',
  }, nested: { scripts: { hidden: 'not a script' } } }, null, 2);
  documents['src/package.json'] = JSON.stringify({ scripts: { dev: 'node nested.cjs' } }, null, 2);
}
const uploads = new Map<string, Uint8Array>();
const fileRevision = (path: string) => bytesToHex(sha256(utf8ToBytes(documents[path] ?? '')));
export function seedLargeText(atThreshold = false) {
  const prefix = 'const needle = "begin";\n';
  const size = PLAIN_TEXT_THRESHOLD + (atThreshold ? 0 : 128 * 1024);
  documents['large.ts'] = prefix + '// plain text padding\n'.repeat(Math.ceil(size / 20))
    .slice(0, size - prefix.length);
}

function writeText(request: Extract<ProjectBrowserRequest, { operation: 'projectFileWrite' }>) {
  if ('text' in request) {
    if (!request.window) return request.text;
    const original = utf8ToBytes(documents[request.path.replace(request.cwd + '/', '')] ?? '');
    const decoder = new TextDecoder();
    return decoder.decode(original.subarray(0, request.window.offset)) + request.text
      + decoder.decode(original.subarray(request.window.end));
  }
  const chunk = request.upload;
  if (chunk.cancel) { uploads.delete(chunk.token); return; }
  const bytes = uploads.get(chunk.token) ?? new Uint8Array(chunk.size);
  bytes.set(toByteArray(chunk.data), chunk.offset);
  if (!chunk.finish) { uploads.set(chunk.token, bytes); return; }
  uploads.delete(chunk.token);
  return new TextDecoder().decode(bytes);
}

export function seedLargeDirectory(count: number) {
  directories.add('node_modules');
  for (let index = 0; index < count; index += 1) {
    const name = `node_modules/package-${String(index).padStart(5, '0')}.json`;
    documents[name] = JSON.stringify({ index });
  }
}

function searchFiles(cwd: string, query: string): ProjectFilesResponse {
  const term = query.toLowerCase().replace(/\\/g, '/');
  const entries = [...Object.keys(documents), ...directories, 'archive.zip', 'huge.png']
    .filter(path => path && path.toLowerCase().includes(term))
    .map(path => ({ name: path.split('/').at(-1)!, path: `${cwd}/${path}`,
      directory: directories.has(path), relativePath: path }))
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  return { directory: cwd, parent: null, entries, truncated: false };
}

export async function browserRequest<T>(request: ProjectBrowserRequest): Promise<T> {
  const path = request.operation === 'projectFiles' ? request.directory ?? '' : request.path;
  const relative = path === request.cwd ? '' : path.replace(`${request.cwd}/`, '');
  if (request.operation === 'projectFileBlame') {
    const body = typeof document === 'undefined' ? undefined : document.body;
    if (body) body.dataset.blameReads = String(Number(body.dataset.blameReads ?? 0) + 1);
    const status = (body?.dataset.blameStatus ?? 'ready') as ProjectBlame['status'];
    const ages = body?.dataset.blameAges?.split(',').map(Number);
    const authors = ages ? ['Alice 中文', 'Bob', 'Carol', 'Dave'] : ['Alice 中文', 'Bob'];
    const commits = authors.map((author, index) => ({
      hash: String(index + 1).repeat(40), author,
      time: ages ? Math.floor(Date.now() / 1000) - ages[index] * 86400 : 1_700_000_000 + index * 86400,
      timezone: '+0800', summary: index ? 'Update content' : 'Initial content',
    }));
    const lines = (documents[relative] ?? '').split('\n');
    const ranges = lines.length > 100 ? [{ start: 1, count: lines.length, commit: 0 }]
      : lines.map((_, index) => ({ start: index + 1, count: 1, commit: index % commits.length }));
    const result: ProjectBlame = { status, revision: fileRevision(relative), commits, ranges };
    if (body?.dataset.blameDelay) {
      await new Promise(resolve => setTimeout(resolve, Number(body.dataset.blameDelay)));
    }
    return result as T;
  }
  if (request.operation === 'projectEntryAction') {
    return mutateFixture(request, { documents, directories, revisions }) as T;
  }
  if (request.operation === 'projectFiles') {
    if (request.query !== undefined) return searchFiles(request.cwd, request.query) as T;
    const prefix = relative ? `${relative}/` : '';
    const names = new Map<string, boolean>();
    for (const name of [...Object.keys(documents), ...directories, 'archive.zip', 'huge.png']) {
      if (!name.startsWith(prefix) || name === relative || !name) continue;
      const rest = name.slice(prefix.length).split('/');
      names.set(rest[0], rest.length > 1 || directories.has(name));
    }
    const data: ProjectFilesResponse = { directory: path || request.cwd, parent: relative ? request.cwd : null,
      truncated: false, entries: [...names].map(([name, directory]) => ({
        name, directory, path: `${request.cwd}/${prefix}${name}`,
      })).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name)) };
    return data as T;
  }
  if (request.operation === 'projectFileWrite') {
    if (conflict || request.revision !== fileRevision(relative)) {
      throw new Error('文件已在其他地方修改。请先复制你的修改，再重新加载文件。');
    }
    const text = writeText(request);
    if (text === undefined) return {} as T;
    savedFiles.push({ path: request.path, text });
    documents[relative] = text; revisions[relative] = (revisions[relative] ?? 0) + 1;
  }
  const bytes = utf8ToBytes(documents[relative] ?? '');
  if (request.operation === 'projectFileRead' && request.chunk) {
    return { data: fromByteArray(bytes.subarray(request.chunk.offset, request.chunk.offset + request.chunk.length)) } as T;
  }
  const kind = relative === 'archive.zip' ? 'binary' : relative === 'huge.png' ? 'large' : 'text';
  const windowRequest = 'window' in request ? request.window : undefined;
  if (windowRequest?.cancel) return null as T;
  const windowed = bytes.length > FILE_CHUNK_BYTES && !!windowRequest && kind === 'text';
  const offset = windowRequest?.offset ?? 0;
  const end = request.operation === 'projectFileWrite' && 'text' in request
    ? offset + utf8ToBytes(request.text).length : Math.min(bytes.length, offset + 64 * 1024);
  const window = windowed ? { token: windowRequest!.token, offset, end,
    previous: Math.max(0, offset - 64 * 1024) } : undefined;
  const chunked = !windowed && bytes.length > FILE_CHUNK_BYTES;
  const data: ProjectDocument = { path: request.path, kind, size: kind === 'large' ? 70_000_000 : bytes.length,
    readOnly: kind !== 'text', revision: fileRevision(relative), chunked,
    text: windowed ? new TextDecoder().decode(bytes.subarray(offset, end)) : chunked ? undefined : documents[relative],
    ...(window ? { window } : {}) };
  return data as T;
}
