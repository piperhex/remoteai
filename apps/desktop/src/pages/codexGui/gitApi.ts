import { invoke } from "../../api/backend";
import type { GitRequest, GitStatus } from "../../../../../shared/remote-chat/gitWorkspace";
export type { GitRequest, GitStatus, GitWorkspaceClient } from "../../../../../shared/remote-chat/gitWorkspace";

export const gitApi = {
  request: (request: GitRequest) => invoke<GitStatus>("codex_gui_git", { request }),
  undo: (request: { threadId: string; turnId: string; checkOnly?: boolean }) =>
    invoke<{ undone: boolean }>("codex_gui_undo", { request }),
};
