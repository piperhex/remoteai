import { expect, it } from "vitest";
import { parseFileReference } from "../../../../../shared/conversation/fileReference";

it.each([
  ["C:\\项目\\read me.txt:12:3", { path: "C:\\项目\\read me.txt", line: 12, column: 3 }],
  ["/tmp/report.pdf", { path: "/tmp/report.pdf" }],
  ["docs/readme.md#L12-L15", { path: "docs/readme.md", line: 12 }],
  ["./src/main.ts#L4C2", { path: "./src/main.ts", line: 4, column: 2 }],
  ["../report.xlsx", { path: "../report.xlsx" }],
  ["README.md", { path: "README.md" }],
  ["C:/报告 100%.pdf", { path: "C:/报告 100%.pdf" }],
  ["file:///C:/report%20name.txt:3", { path: "C:/report name.txt", line: 3 }],
  ["file:///tmp/report%23name.txt", { path: "/tmp/report#name.txt" }],
  ["/C:/src/main.rs:9", { path: "C:/src/main.rs", line: 9 }],
  ["/tmp/%E6%8A%A5%E5%91%8A.txt", { path: "/tmp/报告.txt" }],
])("parses file link %s", (href, result) => expect(parseFileReference(href as string)).toEqual(result));

it.each(["https://example.com/report.pdf", "javascript:alert(1)", "mailto:me@example.com",
  "plugin://skill/path", "//server/share.txt", "\\\\server\\share.txt", "/__codex_switch__/api/invoke",
  "file://server/share.txt", "file:///tmp/report.txt?secret=1", "#heading", "", "a\0.txt"])(
  "rejects unsupported reference %s", (href) => expect(parseFileReference(href)).toBeUndefined(),
);
