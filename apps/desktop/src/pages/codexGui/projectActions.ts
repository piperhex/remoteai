import { uiText } from "../../../../../shared/localization/uiText";
import { guiApi } from "../../../../../shared/conversation/api";
import { savePreferences } from "./preferences";
import { removeSavedProject } from "../../../../../shared/conversation/projectCatalog";
import type { GuiState, ListResponse, Thread } from "../../../../../shared/conversation/types";
import { forgetGroupedProject, forgetGroupedThread } from './groupActions';

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
  selectRemote = (cwd: string, threadId?: string, removeFromGroup = false) => {
    const state = this.host.getSnapshot();
    const current = threadId ? state.conversations[threadId] : undefined;
    if (state.sending || state.connection !== 'ready' || state.removingProject || state.goalBusy || (threadId
      && (!current || current.activeTurn || state.queued[threadId]?.length || state.compacting === threadId
        || state.deleting === threadId
        || state.approvals.some(event => event.params.threadId === threadId)))) return false;
    this.host.patch({ projects: [...new Set([cwd, ...state.projects])].slice(0, RECENT_PROJECT_LIMIT),
      ...(threadId ? { projectOverrides: { ...state.projectOverrides, [threadId]: cwd },
        ...(removeFromGroup ? { grouping: forgetGroupedThread(state.grouping, threadId) } : {}),
        threads: state.threads.map(thread => thread.id === threadId ? { ...thread, cwd } : thread),
        conversations: { ...state.conversations, [threadId]: { ...current!, thread: { ...current!.thread, cwd } } },
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
        this.host.report(uiText("client.conversation.waitForTheMessageToFinishSendingBeforeRemovingThe"));
        return false;
      }
      removeSavedProject(path);
      this.host.patch({ ...removalPatch(state, path, lists.flat()),
        grouping: forgetGroupedProject(state.grouping, path) });
      savePreferences(this.host.getSnapshot());
      return true;
    } catch {
      this.host.report(uiText("client.conversation.couldNotRemoveTheProjectPleaseTryAgainYourConversations"));
      return false;
    } finally { this.host.patch({ removingProject: undefined }); }
  };
}
