import { getGuiController } from '../pages/codexGui/session';
import { guiApi } from '../pages/codexGui/api';
import { readProjects } from '../pages/codexGui/projectCatalog';
import type { Thread } from '../pages/codexGui/types';
import { directoryProject, type ProjectDirectoriesResponse } from '../../../../shared/remote-chat/projectDirectories';
import type { ChatProject } from '../../../../shared/remote-chat/client/types';

const MAX_PATH_LENGTH = 4096;
const THREAD_ID = /^[a-zA-Z0-9_-]{1,200}$/;

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
  if (!['resume', 'send'].includes(String(body.operation)) || typeof body.threadId !== 'string') return;
  const cwd = getGuiController().getSnapshot().projectOverrides?.[body.threadId];
  if (cwd !== undefined) body.cwd = cwd;
}

export async function selectRemoteProject(body: Record<string, unknown>): Promise<ChatProject> {
  const { cwd, threadId } = body;
  if (typeof cwd !== 'string' || !cwd.trim() || cwd.length > MAX_PATH_LENGTH
    || (threadId !== undefined && (typeof threadId !== 'string' || !THREAD_ID.test(threadId)))) {
    throw new Error('请选择有效的项目文件夹。');
  }
  const controller = getGuiController();
  if (controller.getSnapshot().workspaceBusy || controller.getSnapshot().sending) {
    throw new Error('项目正在处理中，请稍后重试。');
  }
  controller.setWorkspaceBusy(true);
  try {
    if (controller.getSnapshot().connection !== 'ready') await controller.connect({ reuseExisting: true });
    if (controller.getSnapshot().connection !== 'ready') throw new Error('电脑暂未就绪，请稍后重试。');
    const directory = await guiApi.request<ProjectDirectoriesResponse>({ operation: 'projectDirectories', directory: cwd });
    if (!directory.directory) throw new Error('请选择有效的项目文件夹。');
    if (threadId) await controller.loadRemoteThread(threadId);
    if (!controller.projectActions.selectRemote(directory.directory, threadId)) {
      throw new Error('请等待当前任务和待发送消息处理完成后，再切换项目。');
    }
    return directoryProject(directory.directory);
  } finally { controller.setWorkspaceBusy(false); }
}
