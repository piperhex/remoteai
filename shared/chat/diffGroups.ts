import type { DiffFile } from './diff';

interface DiffFolderGroup {
  directory: string;
  name: string;
  entries: { file: DiffFile; index: number }[];
}

/** Preserve source indices so regrouping does not change which diff a file row opens. */
export function groupDiffFiles(files: readonly DiffFile[]): DiffFolderGroup[] {
  const groups = new Map<string, DiffFolderGroup>();
  files.forEach((file, index) => {
    const path = file.path.replace(/\\/g, '/').replace(/^\.\//, '');
    const separator = path.lastIndexOf('/');
    const directory = separator < 0 ? '' : path.slice(0, separator) || '/';
    let group = groups.get(directory);
    if (!group) {
      const name = directory.split('/').pop() || '根目录';
      group = { directory, name, entries: [] };
      groups.set(directory, group);
    }
    group.entries.push({ file, index });
  });
  return [...groups.values()];
}
