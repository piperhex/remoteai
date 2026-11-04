// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { guiApi } from "../../../../../shared/conversation/api";
import { GuiController } from "./controller";
import { conversation } from "../../../../../shared/conversation/events";
import { initialState } from "./preferences";
import { GuiProjects } from "./projectActions";
import { readProjects, saveProject } from "../../../../../shared/conversation/projectCatalog";
import { threadGroups } from "./threadGroups";
import type { GuiState, Thread } from "../../../../../shared/conversation/types";

vi.mock("../../../../../shared/conversation/api", () => ({ guiApi: { request: vi.fn() } }));
const path = "D:/project";
const thread = (id: string, cwd = path): Thread => ({ id, cwd, preview: id, updatedAt: 1, turns: [] });
let state: GuiState;
let projects: GuiProjects;
let report: ReturnType<typeof vi.fn<(error: unknown) => void>>;

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  state = { ...initialState(), connection: "ready" };
  report = vi.fn<(error: unknown) => void>();
  projects = new GuiProjects({ getSnapshot: () => state, report,
    patch: (patch) => { state = { ...state, ...patch }; } });
  vi.mocked(guiApi.request).mockResolvedValue({ data: [], nextCursor: null });
});

it("persists project pinning separately from conversation pins and restores the original order on unpin", () => {
  state.threads = [thread("recent", ""), thread("other", "D:/other"), thread("target")];
  projects.pin(path);
  expect(threadGroups(state).map((group) => group.label)).toEqual(["project", "最近", "other"]);
  expect(initialState().pinnedProjects).toEqual([path]);
  expect(state.pins).toEqual([]);
  projects.pin(path);
  expect(threadGroups(state).map((group) => group.label)).toEqual(["最近", "other", "project"]);
  expect(initialState().pinnedProjects).toEqual([]);
});

it("detaches all pages, archived and live chats, preserves other projects and survives refresh and restart", async () => {
  state.threads = [thread("visible"), thread("other", "D:/other")];
  state.conversations = { live: { ...conversation(thread("live")), activeTurn: "running" } };
  state.projects = [path, "D:/other"];
  state.pinnedProjects = [path];
  state.pins = ["visible", "other"];
  state.settings = { ...state.settings, cwd: path };
  state.projectOverrides = { movedAway: "D:/other", movedIn: path };
  saveProject({ path, name: "项目" });
  saveProject({ path: "D:/other", name: "另一个项目" });
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation !== "list") throw new Error("Unexpected mutation");
    if (request.archived) return { data: [thread("archived")], nextCursor: null };
    if (request.cursor) return { data: [thread("older")], nextCursor: null };
    return { data: [thread("visible"), thread("movedAway"), thread("movedIn", "D:/other")], nextCursor: "page2" };
  });
  expect(await projects.remove(path)).toBe(true);
  expect(state.projectOverrides).toEqual({ movedAway: "D:/other", movedIn: "", visible: "", older: "",
    archived: "", live: "" });
  expect(state.threads.map((entry) => entry.cwd)).toEqual(["", "D:/other"]);
  expect(state.conversations.live.activeTurn).toBe("running");
  expect(state.conversations.live.thread.cwd).toBe("");
  expect(state.pins).toEqual(["other"]);
  expect(state.pinnedProjects).toEqual([]);
  expect(state.settings.cwd).toBe("");
  expect(state.projects).toEqual(["D:/other"]);
  expect(readProjects().map((entry) => entry.path)).toEqual(["D:/other"]);
  expect(initialState().projectOverrides).toEqual(state.projectOverrides);
  const restored = new GuiController();
  await restored.refresh();
  await restored.refresh(true);
  expect(restored.getSnapshot().threads.find((entry) => entry.id === "older")?.cwd).toBe("");
  restored.settings({ cwd: path });
  expect(restored.getSnapshot().projectOverrides.older).toBe("");
  restored.dispose();
});

it("keeps the project and conversations unchanged if an older page cannot be loaded", async () => {
  state.threads = [thread("one")];
  state.projects = [path];
  saveProject({ path, name: "项目" });
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "list" && request.cursor) throw new Error("offline");
    return { data: [thread("one")], nextCursor: "page2" };
  });
  expect(await projects.remove(path)).toBe(false);
  expect(state.projectOverrides).toEqual({});
  expect(state.threads[0].cwd).toBe(path);
  expect(readProjects()).toHaveLength(1);
  expect(state.removingProject).toBeUndefined();
  expect(report).toHaveBeenCalled();
});

it("allows only one removal at a time and respects a project changed while loading", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const removing = projects.remove(path);
  expect(await projects.remove(path)).toBe(false);
  state.projectOverrides.one = "D:/other";
  finish({ data: [thread("one")], nextCursor: null });
  expect(await removing).toBe(true);
  expect(state.projectOverrides.one).toBe("D:/other");
});
