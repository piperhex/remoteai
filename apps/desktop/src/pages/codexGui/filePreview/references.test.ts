import { expect, it } from "vitest";
import { all, createLowlight } from "lowlight";
import { fileLanguage } from "../../../../../../shared/file-preview/workspace/fileLanguages";
import { previewImageUrl, previewReference } from "../../../../../../shared/file-preview/workspace/references";

it.each([
  ["a.ts", "typescript"], ["a.rs", "rust"], ["a.yml", "yaml"], ["a.TOML", "ini"],
  ["a.ps1", "powershell"], ["a.cpp", "cpp"], ["a.cs", "csharp"], ["a.swift", "swift"],
  ["a.kt", "kotlin"], ["a.dart", "dart"], ["a.vue", "xml"], ["a.sql", "sql"],
  ["Dockerfile.dev", "dockerfile"], ["Makefile", "makefile"], ["CMakeLists.txt", "cmake"],
  [".env.local", "bash"], [".editorconfig", "ini"], ["a.proto", "protobuf"],
])("selects a registered highlighter for %s", (path, language) => {
  expect(fileLanguage(path)).toBe(language);
  expect(createLowlight(all).registered(language)).toBe(true);
});

it("recognizes extensionless scripts and leaves unknown text readable", () => {
  expect(fileLanguage("scripts/build", "#!/usr/bin/env python3\nprint(1)")).toBe("python");
  expect(fileLanguage("LICENSE", "Terms")).toBe("");
});

it("resolves document links from the document directory and keeps source locations", () => {
  expect(previewReference("../src/main.rs#L12C3", "C:/project/docs/readme.md"))
    .toEqual({ path: "C:/project/docs/../src/main.rs", line: 12, column: 3 });
  expect(previewReference("LICENSE", "/project/readme.md")).toEqual({ path: "/project/LICENSE" });
  expect(previewReference("/other/readme.md", "/project/docs.md")).toEqual({ path: "/other/readme.md" });
  expect(previewReference("javascript:alert(1)", "/project/docs.md")).toBeUndefined();
  expect(previewReference("#heading", "/project/docs.md")).toBeUndefined();
});

it("keeps relative images on the scoped server and excludes other local and executable URLs", () => {
  const base = "http://127.0.0.1:4321/token/README.md";
  expect(previewImageUrl("./images/picture.png", base)).toBe("http://127.0.0.1:4321/token/images/picture.png");
  expect(previewImageUrl("https://example.com/a.png", base)).toBe("https://example.com/a.png");
  expect(previewImageUrl("C:/docs/image%20one.png", base, "C:/docs/readme.md"))
    .toBe("http://127.0.0.1:4321/token/image%20one.png");
  for (const source of ["javascript:alert(1)", "file:///secret.png", "C:/secret.png", "//server/image.png"]) {
    expect(previewImageUrl(source, base)).toBeUndefined();
  }
});
