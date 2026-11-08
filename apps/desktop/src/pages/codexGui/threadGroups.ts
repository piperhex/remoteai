import { uiText } from "../../../../../shared/localization/uiText";
import { projectName } from "../../../../../shared/conversation/projectCatalog";
import type { GuiState, Thread } from "../../../../../shared/conversation/types";
import { isThreadRunning } from "./threadRunning";
import { orderThreadsByActivity } from "../../../../../shared/chat/threadOrder";

export function orderGuiThreads(threads: readonly Thread[], state: GuiState) {
  return orderThreadsByActivity(threads, {
    isRunning: thread => isThreadRunning(state, thread),
    isPinned: thread => state.pins.includes(thread.id),
  });
}

export function threadGroups(state: GuiState) {
  const pinnedIds = new Set(state.threads.filter(thread => state.pins.includes(thread.id)
    && !state.grouping.projects[thread.cwd]).map(thread => thread.id));
  const pinned = state.threads.filter((thread) => pinnedIds.has(thread.id));
  const byProject = new Map<string, Thread[]>();
  state.threads.filter((thread) => !pinnedIds.has(thread.id)).forEach((thread) => {
    const key = thread.cwd || "";
    byProject.set(key, [...(byProject.get(key) ?? []), thread]);
  });
  const projects = Array.from(byProject, ([path, threads]) => ({
    id: `project:${path}`, label: projectName(path), pinned: false, cwd: path, threads,
  }));
  projects.sort((left, right) => Number(state.pinnedProjects.includes(right.cwd))
    - Number(state.pinnedProjects.includes(left.cwd)));
  return [
    ...(pinned.length ? [{ id: "pinned", label: uiText("client.conversation.pin"), pinned: true, cwd: "", threads: pinned }] : []),
    ...projects,
  ].map((group) => ({ ...group,
    threads: orderGuiThreads(group.threads, state),
  }));
}
