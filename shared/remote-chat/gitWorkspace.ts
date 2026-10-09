export interface GitStatus {
  cwd: string;
  branch: string | null;
  branches: { name: string; occupied: boolean }[];
  changedFiles: number;
  isWorktree: boolean;
}

export type GitRequest = { operation: 'status'; cwd: string }
  | { operation: 'switch'; cwd: string; branch: string; create: boolean }
  | { operation: 'createWorktree'; cwd: string; branch: string };

export type GitWorkspaceClient = (request: GitRequest) => Promise<GitStatus>;
