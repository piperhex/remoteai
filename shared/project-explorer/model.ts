import type { MessageKey, TranslationValues } from '@remoteai/i18n';
import type { ProjectDirectory, ProjectPickerProps } from '../remote-chat/projectDirectories';

export type Translate = (key: MessageKey, values?: TranslationValues) => string;
export type ExplorerEntry = ProjectDirectory & { directory: boolean };
export type ExplorerProps = Omit<ProjectPickerProps, 'choose'> & { t: Translate; locale: string } & (
  { mode: 'browse'; choose?: never } | { mode?: 'select'; choose: ProjectPickerProps['choose'] }
);
export const VIEWS = ['extraLarge', 'large', 'medium', 'small', 'list', 'details', 'tiles', 'content'] as const;
export type View = typeof VIEWS[number];
export const SORTS = ['name', 'modified', 'type', 'size'] as const;
export type Sort = typeof SORTS[number];
export const textKey = (key: string) => `client.projectExplorer.${key}` as MessageKey;
export const normalize = (path: string) => path === '/' ? '/' : path.replace(/\\/g, '/').replace(/\/+$/, '');
export const samePath = (a: string, b: string) => /^[a-z]:|^\\\\|^\/\//i.test(a)
  ? normalize(a).toLowerCase() === normalize(b).toLowerCase() : normalize(a) === normalize(b);

/** Preserve drive, POSIX and UNC roots when constructing navigation targets. */
export function pathParts(path: string) {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  let root = '/';
  if (normalized.startsWith('//')) root = `//${parts.splice(0, 2).join('/')}/`;
  else if (/^[a-z]:/i.test(normalized)) root = `${parts.shift()}/`;
  return [{ name: root, path: root }, ...parts.map((name, index) => ({
    name, path: root + parts.slice(0, index + 1).join('/'),
  }))];
}

export function entryType(entry: ExplorerEntry, t: Translate) {
  if (entry.directory) return t(textKey('folder'));
  const extension = entry.name.includes('.') ? entry.name.split('.').at(-1)?.toUpperCase() : '';
  return extension ? t(textKey('fileType'), { extension }) : t(textKey('file'));
}

export function entrySize(entry: ExplorerEntry, locale: string) {
  if (entry.directory) return '';
  if (entry.size == null) return '—';
  return `${new Intl.NumberFormat(locale).format(Math.ceil(entry.size / 1024))} KB`;
}

export function entryDate(entry: ExplorerEntry, locale: string) {
  return entry.modified == null ? '—' : new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(entry.modified * 1000);
}

export function visibleEntries(options: {
  entries: ExplorerEntry[]; query: string; hidden: boolean; sort: Sort; descending: boolean;
}) {
  const query = options.query.trim().toLocaleLowerCase();
  const entries = options.entries.filter(entry => (options.hidden || !entry.name.startsWith('.'))
    && entry.name.toLocaleLowerCase().includes(query));
  return entries.sort((a, b) => {
    if (a.directory !== b.directory) return a.directory ? -1 : 1;
    let order = 0;
    if (options.sort === 'modified' || options.sort === 'size') {
      order = (a[options.sort] ?? -1) - (b[options.sort] ?? -1);
    } else if (options.sort === 'type') {
      order = (a.name.split('.').at(-1) ?? '').localeCompare(b.name.split('.').at(-1) ?? '');
    }
    order ||= a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    return options.descending ? -order : order;
  });
}
