// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ComposerSkillIcon } from "./ComposerSkillIcon";
import { ComposerPluginIcon } from "./ComposerPluginIcon";
import type { Skill } from "../../../../../shared/conversation/types";

let root: Root;
let host: HTMLDivElement;
const skill: Skill = { name: "demo", path: "demo/SKILL.md", description: "Demo", enabled: true };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("shows local skill assets, falls back after image errors, and retries a changed icon", async () => {
  const iconUrl = "data:image/svg+xml;base64,PHN2Zy8+";
  await act(async () => root.render(<ComposerSkillIcon skill={{ ...skill, iconUrl }} />));
  expect(host.querySelector("img")?.getAttribute("src")).toBe(iconUrl);
  await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector("svg")).not.toBeNull();
  await act(async () => root.render(<ComposerSkillIcon skill={{ ...skill, iconUrl: "https://example.com/new.svg" }} />));
  expect(host.querySelector("img")?.getAttribute("src")).toBe("https://example.com/new.svg");
});

it("uses the large remote skill icon when the small icon fails", async () => {
  await act(async () => root.render(<ComposerSkillIcon skill={{ ...skill,
    interface: { iconSmallUrl: "https://example.com/small.svg", iconLargeUrl: "https://example.com/large.png" } }} />));
  expect(host.querySelector("img")?.getAttribute("referrerpolicy")).toBe("no-referrer");
  await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(host.querySelector("img")?.getAttribute("src")).toBe("https://example.com/large.png");
});

it("supports plugin logos and rejects direct filesystem and script URLs", async () => {
  await act(async () => root.render(<ComposerPluginIcon plugin={{ id: "demo", name: "demo", installed: true,
    enabled: true, iconUrl: "file:///private/icon.png", interface: { composerIconUrl: "javascript:alert(1)",
      logoUrl: "https://example.com/logo.png" } }} />));
  expect(host.querySelector("img")?.getAttribute("src")).toBe("https://example.com/logo.png");
});
