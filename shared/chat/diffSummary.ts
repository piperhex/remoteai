import type { DiffFile } from './diff';

export interface DiffFileSummary { readonly path: string; readonly added: number; readonly removed: number }
export interface DiffSummary {
  readonly files: readonly DiffFileSummary[];
  readonly added: number;
  readonly removed: number;
}

// Lifetime follows the immutable parsed list; this cache cannot keep discarded conversations alive.
const summaries = new WeakMap<readonly DiffFile[], DiffSummary>();

export function summarizeDiffFiles(files: readonly DiffFile[]): DiffSummary {
  const cached = summaries.get(files);
  if (cached) return cached;
  const paths = new Map<string, DiffFileSummary>();
  let added = 0;
  let removed = 0;
  for (const file of files) {
    const previous = paths.get(file.path);
    paths.set(file.path, Object.freeze({ path: file.path, added: (previous?.added ?? 0) + file.added,
      removed: (previous?.removed ?? 0) + file.removed }));
    added += file.added;
    removed += file.removed;
  }
  const summary = Object.freeze({ files: Object.freeze([...paths.values()]), added, removed });
  summaries.set(files, summary);
  return summary;
}
