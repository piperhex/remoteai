import type { FileChange } from "../../apps/desktop/src/pages/codexGui/types";
import { DiffCache } from "./diffCache";
import { parseFileChange, parseUnifiedDiff } from "./diffParser";

export interface DiffLine {
  readonly kind: "context" | "add" | "remove" | "hunk" | "meta";
  readonly text: string;
  readonly oldLine?: number;
  readonly newLine?: number;
}
export interface DiffFile {
  readonly path: string;
  readonly previousPath?: string;
  readonly kind: string;
  readonly raw: string;
  readonly lines: readonly DiffLine[];
  readonly added: number;
  readonly removed: number;
}
export interface DiffPair { left?: DiffLine; right?: DiffLine; heading?: DiffLine }

const parsedCache = new DiffCache<readonly DiffFile[]>();
const fileIds = new WeakMap<DiffFile, number>();
let nextFileId = 0;
const EMPTY_FILES: readonly DiffFile[] = Object.freeze([]);
const LINE_WEIGHT = 128;
const FILE_WEIGHT = 512;

function filesWeight(files: readonly DiffFile[]): number {
  // UTF-16 raw + line text, row objects, paths, arrays and summary rows. DiffCache also charges the key.
  // Shared files are deliberately charged again for list entries so aggregate lists cannot bypass the budget.
  return files.reduce((sum, file) => sum + FILE_WEIGHT + file.raw.length * 4
    + (file.path.length + (file.previousPath?.length ?? 0)) * 4 + file.lines.length * LINE_WEIGHT, 0);
}

function freezeFiles(files: DiffFile[]): readonly DiffFile[] {
  for (const file of files) {
    file.lines.forEach(Object.freeze);
    Object.freeze(file.lines);
    Object.freeze(file);
  }
  return Object.freeze(files);
}

/** Parsing depends only on diff content and file metadata, never on turn/status/UI state. */
export function changedFiles(changes: readonly FileChange[]): readonly DiffFile[] {
  if (!changes.length) return EMPTY_FILES;
  const files = changes.map(change => {
    const options = JSON.stringify([change.path, change.kind.type, change.kind.movePath ?? null]);
    const cached = parsedCache.get(change.diff, options);
    if (cached) return cached[0];
    const parsed = freezeFiles([parseFileChange(change)]);
    return parsedCache.set(change.diff, options, parsed, filesWeight(parsed))[0];
  });
  // Compare just parsed-file identities; never stringify or deep-compare turn/items/code here.
  const key = files.map(file => {
    let id = fileIds.get(file);
    if (id === undefined) { id = ++nextFileId; fileIds.set(file, id); }
    return id;
  }).join(',');
  return parsedCache.get(key, 'list')
    ?? parsedCache.set(key, 'list', Object.freeze(files), filesWeight(files));
}

/** Keep headers and unsupported/binary patches visible without inventing line numbers. */
export function parseDiff(diff: string): readonly DiffFile[] {
  if (!diff) return EMPTY_FILES;
  const cached = parsedCache.get(diff, 'patch');
  if (cached) return cached;
  const files = freezeFiles(parseUnifiedDiff(diff));
  return parsedCache.set(diff, 'patch', files, filesWeight(files));
}

export function pairDiffLines(lines: readonly DiffLine[]): DiffPair[] {
  const pairs: DiffPair[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.kind === "hunk" || line.kind === "meta") { pairs.push({ heading: line }); index++; continue; }
    if (line.kind === "context") { pairs.push({ left: line, right: line }); index++; continue; }
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (lines[index]?.kind === "remove") removed.push(lines[index++]);
    while (lines[index]?.kind === "add") added.push(lines[index++]);
    for (let row = 0; row < Math.max(removed.length, added.length); row++) {
      pairs.push({ left: removed[row], right: added[row] });
    }
  }
  return pairs;
}
