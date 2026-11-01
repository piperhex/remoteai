import type { FileChange } from "../../apps/desktop/src/pages/codexGui/types";
import type { DiffFile, DiffLine } from "./diff";

function linesOf(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Git quotes non-ASCII paths as UTF-8 octal bytes when core.quotePath is enabled. */
function decodePath(value: string) {
  const path = value.trim();
  if (!path.startsWith('"')) return path.split("\t")[0];
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  const quoted = path.match(/^"((?:\\.|[^"\\])*)"/)?.[1] ?? path;
  for (const token of quoted.match(/\\[0-7]{1,3}|\\.|[^\\]+/g) ?? []) {
    if (/^\\[0-7]/.test(token)) bytes.push(parseInt(token.slice(1), 8));
    else bytes.push(...encoder.encode(token.replace(/\\(["\\tnr])/g,
      (_, char: string) => ({ t: "\t", n: "\n", r: "\r" })[char] ?? char)));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function stripPrefix(value: string) { return decodePath(value).replace(/^[ab]\//, ""); }

function parseLines(raw: string, kind: string): DiffLine[] {
  const source = linesOf(raw);
  // Add/delete items from app-server contain the whole file, without patch markers.
  if (kind === "add" || kind === "delete") {
    return source.map((text, index) => kind === "add"
      ? { kind: "add", text, newLine: index + 1 } : { kind: "remove", text, oldLine: index + 1 });
  }
  let oldLine: number | undefined;
  let newLine: number | undefined;
  return source.map((text): DiffLine => {
    const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]); newLine = Number(hunk[2]);
      return { kind: "hunk", text };
    }
    if (oldLine == null || newLine == null || text.startsWith("\\")) return { kind: "meta", text };
    if (text.startsWith("+")) return { kind: "add", text: text.slice(1), newLine: newLine++ };
    if (text.startsWith("-")) return { kind: "remove", text: text.slice(1), oldLine: oldLine++ };
    if (text.startsWith(" ")) return { kind: "context", text: text.slice(1), oldLine: oldLine++, newLine: newLine++ };
    return { kind: "meta", text };
  });
}

export function parseFileChange(change: FileChange, patch = false): DiffFile {
  const lines = parseLines(change.diff, patch ? "patch" : change.kind.type);
  return { path: change.kind.movePath || change.path,
    previousPath: change.kind.movePath ? change.path : undefined, kind: change.kind.type,
    raw: change.diff, lines,
    added: lines.filter((line) => line.kind === "add").length,
    removed: lines.filter((line) => line.kind === "remove").length };
}

function parsePatch(raw: string): DiffFile {
  const header = raw.split(/^@@ /m)[0];
  const oldPath = header.match(/^--- (.+)$/m)?.[1];
  const newPath = header.match(/^\+\+\+ (.+)$/m)?.[1];
  const renamedFrom = header.match(/^rename from (.+)$/m)?.[1];
  const renamedTo = header.match(/^rename to (.+)$/m)?.[1];
  const gitPaths = header.match(/^diff --git ("(?:\\.|[^"\\])*"|.+?) ("(?:\\.|[^"\\])*"|b\/.+)$/m);
  const kind = /new file mode/m.test(header) || oldPath === "/dev/null" ? "add"
    : /deleted file mode/m.test(header) || newPath === "/dev/null" ? "delete" : "update";
  const path = stripPrefix((newPath === "/dev/null" ? oldPath : newPath) ?? gitPaths?.[2] ?? "文件修改");
  return parseFileChange({ path: renamedFrom ? decodePath(renamedFrom) : path, diff: raw,
    kind: { type: kind, movePath: renamedTo ? decodePath(renamedTo) : undefined } }, true);
}

/** Keep headers and unsupported/binary patches visible without inventing line numbers. */
export function parseUnifiedDiff(diff: string): DiffFile[] {
  if (!diff.trim()) return [];
  const normalized = diff.replace(/\r\n/g, "\n");
  const separator = /^diff --git /m.test(normalized) ? /(?=^diff --git )/m : /(?=^--- .+\n\+\+\+ )/m;
  return normalized.split(separator).filter((part) => part.trim()).map(parsePatch);
}
