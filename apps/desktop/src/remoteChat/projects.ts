import { getGuiController } from '../pages/codexGui/session';
import { selectGuiProject } from '../pages/codexGui/projectSelection';
import { guiSidebar } from '../pages/codexGui/sidebarBridge';
import { readProjects } from '../../../../shared/conversation/projectCatalog';
import type { Thread } from '../../../../shared/conversation/types';
import { directoryProject } from '../../../../shared/remote-chat/projectDirectories';
import type { ChatProject } from '../../../../shared/remote-chat/client/types';

export function readRemoteProjects(): ChatProject[] {
  const state = getGuiController().getSnapshot();
  const saved = readProjects().map(project => ({ cwd: project.path, label: project.name }));
  const paths = [...state.projects, ...state.threads.map(thread => effectiveProjectThread(thread).cwd)];
  const projects = new Map(saved.map(project => [project.cwd, project]));
  for (const cwd of paths) if (cwd && !projects.has(cwd)) projects.set(cwd, directoryProject(cwd));
  return [...projects.values()];
}

export function effectiveProjectThread(thread: Thread): Thread {
  const cwd = getGuiController().getSnapshot().projectOverrides?.[thread.id];
  return cwd === undefined ? thread : { ...thread, cwd };
}

export function applyProjectOverride(body: Record<string, unknown>) {
  if (!['resume', 'send', 'projectFiles'].includes(String(body.operation)) || typeof body.threadId !== 'string') return;
  const cwd = getGuiController().getSnapshot().projectOverrides?.[body.threadId];
  if (cwd === undefined) return;
  body.cwd = cwd;
  // The app-server retains the old cwd until the next turn; only the host-confirmed override may replace it.
  if (body.operation === 'projectFiles') delete body.threadId;
}

export async function selectRemoteProject(body: Record<string, unknown>) {
  const project = await selectGuiProject(getGuiController(), body);
  return body.removeFromGroup ? { ...project, sidebar: guiSidebar.snapshot() } : project;
}
