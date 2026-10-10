import { createContext } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FileReference } from "./fileReference";

export const FileThreadContext = createContext<string | null>(null);
export interface FileApplication { id: string; name: string; kind: "editor" | "terminal" | "system"; icon?: string }
export type FileAction = { type: "open"; application: string }
  | { type: "copyFile" | "copyPath" | "copyContents" | "saveAs" | "reveal" };
export interface FileActionResult { path: string; text?: string; saved: boolean }

// These local actions deliberately use desktop IPC; a remote browser cannot launch host applications.
export const fileApi = {
  applications: () => invoke<FileApplication[]>("codex_gui_file_applications"),
  perform: (target: FileReference & { threadId: string | null }, action: FileAction) =>
    invoke<FileActionResult>("codex_gui_file_action", { request: { target, action } }),
};
