import { hasLocalBackend, invoke } from "./backend";

export type ErrorLogSource = "proxy" | "toast" | "codex";

export interface ErrorLogEntry {
  id: number;
  createdAt: string;
  source: ErrorLogSource;
  message: string;
  statusCode?: number | null;
}

export interface ErrorLogPage {
  entries: ErrorLogEntry[];
  hasMore: boolean;
  total: number;
  page: number;
  snapshotId: number | null;
}

interface ErrorLogQuery {
  limit?: number;
  beforeId?: number;
  source?: ErrorLogSource;
  pagination?: { page: number; snapshotId?: number | null };
}

export async function listErrorLogs(query: ErrorLogQuery = {}): Promise<ErrorLogPage> {
  if (!hasLocalBackend) return { entries: [], hasMore: false, total: 0, page: 1, snapshotId: null };
  return invoke<ErrorLogPage>("list_error_logs", { ...query });
}

export async function clearErrorLogs(): Promise<void> {
  if (hasLocalBackend) await invoke("clear_error_logs");
}

export async function recordToastLog(message: string): Promise<void> {
  if (hasLocalBackend && message.trim()) await invoke("record_toast_log", { message });
}
