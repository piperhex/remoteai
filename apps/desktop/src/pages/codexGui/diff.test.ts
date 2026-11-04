import { describe, expect, it } from "vitest";
import { changedFiles, pairDiffLines, parseDiff } from "../../../../../shared/conversation/diff";

describe("file changes and unified patches", () => {
  it("marks every raw line of new/deleted files, including empty lines and marker-like text", () => {
    const [added, removed] = changedFiles([
      { path: "new.ts", kind: { type: "add" }, diff: "const count = 2;\n\n+++ text\n" },
      { path: "old.ts", kind: { type: "delete" }, diff: "old\n" },
    ]);
    expect(added.added).toBe(3);
    expect(added.lines[2]).toEqual({ kind: "add", text: "+++ text", newLine: 3 });
    expect(removed.lines[0]).toEqual({ kind: "remove", text: "old", oldLine: 1 });
  });

  it("keeps old/new line numbers across hunks and never counts file headers as edits", () => {
    const [file] = parseDiff("diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n"
      + "@@ -10,2 +10,3 @@\n keep\n-old\n+new\n+extra\n@@ -25 +26 @@\n-before\n+after\n"
      + "\\ No newline at end of file\n");
    expect(file.path).toBe("src/a.ts");
    expect([file.added, file.removed]).toEqual([3, 2]);
    expect(file.lines.find((line) => line.text === "extra")?.newLine).toBe(12);
    expect(file.lines.find((line) => line.text === "before")?.oldLine).toBe(25);
    expect(file.lines.at(-1)?.kind).toBe("meta");
  });

  it("supports multiple files, renames, quoted UTF-8 paths, and binary patches", () => {
    const files = parseDiff('diff --git a/old.txt b/new.txt\nsimilarity index 100%\n'
      + 'rename from old.txt\nrename to new.txt\n'
      + 'diff --git "a/\\344\\270\\255.txt" "b/\\344\\270\\255.txt"\n'
      + 'new file mode 100644\n--- /dev/null\n+++ "b/\\344\\270\\255.txt"\n@@ -0,0 +1 @@\n+内容\n'
      + 'diff --git a/pic.png b/pic.png\nBinary files a/pic.png and b/pic.png differ\n');
    expect(files).toHaveLength(3);
    expect(files[0]).toMatchObject({ previousPath: "old.txt", path: "new.txt", added: 0, removed: 0 });
    expect(files[1]).toMatchObject({ path: "中.txt", kind: "add", added: 1, removed: 0 });
    expect(files[2].lines.at(-1)?.text).toContain("Binary files");
  });

  it("pairs replacements and pads unequal sides without losing context", () => {
    const [file] = changedFiles([{ path: "test", kind: { type: "update" },
      diff: "@@ -1,2 +1,3 @@\n-old\n+new\n+more\n same\n" }]);
    const pairs = pairDiffLines(file.lines);
    expect(pairs[1]).toMatchObject({ left: { text: "old" }, right: { text: "new" } });
    expect(pairs[2]).toMatchObject({ left: undefined, right: { text: "more" } });
    expect(pairs[3]).toMatchObject({ left: { oldLine: 2 }, right: { newLine: 3 } });
  });

  it("preserves unsupported patch text and empty file changes without fabricated numbers", () => {
    expect(parseDiff("")).toEqual([]);
    expect(parseDiff("mode changed")[0].lines[0]).toEqual({ kind: "meta", text: "mode changed" });
    expect(changedFiles([{ path: "empty", kind: { type: "add" }, diff: "" }])[0].added).toBe(0);
  });
});
