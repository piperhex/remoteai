import type { GuiState, Settings, ThreadReadState } from "../../../../../shared/conversation/types";
import { ACCESS_OPTIONS } from "../../../../../shared/remote-chat/composer";
import { loadGrouping } from './groupActions';

const STORAGE_KEY = "codex-switch:gui";
const DEFAULT_SETTINGS: Settings = { cwd: "", model: "", effort: "", access: "workspace-write" };

function readThreadStates(value: unknown): Record<string, ThreadReadState> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, ThreadReadState] => {
    const record: unknown = entry[1];
    return Boolean(record && typeof record === "object" && "turnId" in record && "unread" in record
      && typeof record.turnId === "string" && typeof record.unread === "boolean");
  }));
}

export function initialState(): GuiState {
  let settings = DEFAULT_SETTINGS;
  let pins: string[] = [];
  let projects: string[] = [];
  let pinnedProjects: string[] = [];
  let threadReadState: Record<string, ThreadReadState> = {};
  let projectOverrides: Record<string, string> = {};
  let selected: string | null = null;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    const saved = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    threadReadState = readThreadStates(saved.threadReadState);
    if (typeof saved.selected === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(saved.selected)) selected = saved.selected;
    settings = { ...DEFAULT_SETTINGS, cwd: typeof saved.cwd === "string" ? saved.cwd : "",
      access: ACCESS_OPTIONS.find((option) => option.value === saved.access)?.value ?? DEFAULT_SETTINGS.access };
    pins = Array.isArray(saved.pins) ? saved.pins.filter((v: unknown) => typeof v === "string") : [];
    projects = Array.isArray(saved.projects) ? saved.projects.filter((v: unknown) => typeof v === "string") : [];
    pinnedProjects = Array.isArray(saved.pinnedProjects)
      ? saved.pinnedProjects.filter((v: unknown) => typeof v === "string") : [];
    if (saved.projectOverrides && typeof saved.projectOverrides === "object") {
      projectOverrides = Object.fromEntries(Object.entries(saved.projectOverrides)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    }
  } catch { /* Preferences are optional; corrupted or unavailable storage uses defaults. */ }
  return { connection: "offline", threads: [], conversations: {}, queued: {}, selected, models: [], approvals: [],
    settings, loading: false, sending: false, archived: false, search: "", cursor: null, error: "", pins, projects,
    projectOverrides, pinnedProjects, threadReadState, grouping: loadGrouping() };
}

export function savePreferences(state: GuiState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ cwd: state.settings.cwd, selected: state.selected,
      access: state.settings.access,
      pins: state.pins, projects: state.projects, pinnedProjects: state.pinnedProjects,
      projectOverrides: state.projectOverrides, threadReadState: state.threadReadState }));
  } catch { /* A storage failure must not prevent an in-memory conversation. */ }
}
