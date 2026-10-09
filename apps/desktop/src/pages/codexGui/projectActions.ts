import { guiText } from "../../i18n/guiText";
import { guiApi } from "./api";
import { savePreferences } from "./preferences";
import { removeSavedProject } from "./projectCatalog";
import type { GuiState, ListResponse, Thread } from "./types";

interface ProjectHost {
  getSnapshot: () => GuiState;
  patch: (patch: Partial<GuiState>) => void;
  report: (error: unknown) => void;
}

const RECENT_PROJECT_LIMIT = 20;

async function listAllThreads(archived: boolean) {
  const threads: Thread[] = [];
  let cursor: string | undefined;
  do {
    const response = await guiApi.request<ListResponse<Thread>>({ operation: "list", archived, cursor });
    threads.push(...response.data);
    cursor = response.nextCursor || undefined;
  } while (cursor);
  return threads;
}

function removalPatch(state: GuiState, path: string, listed: Thread[]): Partial<GuiState> {
  const known = [...listed, ...state.threads, ...Object.values(state.conversations).map((value) => value.thread)];
  const ids = new Set(known.filter((thread) => (state.projectOverrides[thread.id] ?? thread.cwd) === path)
    .map((thread) => thread.id));
  const projectOverrides = { ...state.projectOverrides };
  ids.forEach((id) => { projectOverrides[id] = ""; });
  const detach = (thread: Thread) => ids.has(thread.id) ? { ...thread, cwd: "" } : thread;
  return {
    projectOverrides,
    projects: state.projects.filter((project) => project !== path),
    pinnedProjects: state.pinnedProjects.filter((project) => project !== path),
    pins: state.pins.filter((id) => !ids.has(id)),
    settings: { ...state.settings, cwd: state.settings.cwd === path ? "" : state.settings.cwd },
    threads: state.threads.map(detach),
    conversations: Object.fromEntries(Object.entries(state.conversations)
      .map(([id, value]) => [id, ids.has(id) ? { ...value, thread: detach(value.thread) } : value])),
  };
}

export class GuiProjects {
  constructor(private host: ProjectHost) {}

  /** Applies a validated remote folder without changing the desktop's selected conversation. */
  selectRemote = (cwd: string, threadId?: string) => {
    const state = this.host.getSnapshot();
    const current = threadId ? state.conversations[threadId] : undefined;
    if (state.sending || state.connection !== 'ready' || state.removingProject || state.goalBusy || (threadId
      && (!current || current.activeTurn || state.queued[threadId]?.length || state.compacting === threadId
        || state.deleting === threadId
        || state.approvals.some(event => event.params.threadId === threadId)))) return false;
    this.host.patch({ projects: [...new Set([cwd, ...state.projects])].slice(0, RECENT_PROJECT_LIMIT),
      ...(threadId ? { projectOverrides: { ...state.projectOverrides, [threadId]: cwd },
        threads: state.threads.map(thread => thread.id === threadId ? { ...thread, cwd } : thread),
        ...(state.selected === threadId ? { settings: { ...state.settings, cwd } } : {}) } : {}) });
    savePreferences(this.host.getSnapshot());
    return true;
  };

  pin = (path: string) => {
    if (!path) return;
    const { pinnedProjects } = this.host.getSnapshot();
    this.host.patch({ pinnedProjects: pinnedProjects.includes(path)
      ? pinnedProjects.filter((project) => project !== path) : [...pinnedProjects, path] });
    savePreferences(this.host.getSnapshot());
  };

  remove = async (path: string) => {
    const before = this.host.getSnapshot();
    if (!path || before.removingProject || before.sending || before.connection !== "ready") return false;
    this.host.patch({ removingProject: path });
    try {
      // Include older pages and archived chats, regardless of the sidebar's current search or tab.
      const lists = await Promise.all([listAllThreads(false), listAllThreads(true)]);
      const state = this.host.getSnapshot();
      if (state.sending) {
        this.host.report(guiText("请等待消息发送完成后，再移除项目。"));
        return false;
      }
      removeSavedProject(path);
      this.host.patch(removalPatch(state, path, lists.flat()));
      savePreferences(this.host.getSnapshot());
      return true;
    } catch {
      this.host.report(guiText("项目未能移除，请重试。对话已保留。"));
      return false;
    } finally { this.host.patch({ removingProject: undefined }); }
  };
}
