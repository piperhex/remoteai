import { useCallback, useEffect, useRef, useState } from "react";
import { message } from "antd";
import { guiText } from "../../../i18n/guiText";
import { filePreviewApi, type FilePreviewData } from "./api";

type FileTarget = Parameters<typeof filePreviewApi.open>[0];
type Target = { kind: "file"; file: FileTarget } | { kind: "website"; url: string };
type Preview = { kind: "file"; data: FilePreviewData } | { kind: "website"; url: string };
interface History { entries: Target[]; index: number }
const EMPTY_HISTORY: History = { entries: [], index: -1 };
const MAX_HISTORY_ENTRIES = 100;

function release(data: FilePreviewData) {
  void filePreviewApi.close(data.sessionId).catch(error => console.error("Failed to release file preview", error));
}

function sameTarget(current: Target | undefined, next: Target) {
  if (current?.kind === "website" && next.kind === "website") return current.url === next.url;
  if (current?.kind !== "file" || next.kind !== "file") return false;
  return current.file.path === next.file.path && current.file.threadId === next.file.threadId
    && current.file.line === next.file.line && current.file.column === next.file.column;
}

function append(history: History, target: Target): History {
  if (sameTarget(history.entries[history.index], target)) return history;
  const entries = [...history.entries.slice(0, history.index + 1), target].slice(-MAX_HISTORY_ENTRIES);
  return { entries, index: entries.length - 1 };
}

export function usePreviewHistory({ onOpen, onNavigate }: { onOpen: () => void; onNavigate: () => void }) {
  // Retain targets only: old file URLs belong to released sessions and must be reopened when revisited.
  const history = useRef(EMPTY_HISTORY);
  const request = useRef(0);
  const pending = useRef(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const cancel = useCallback(() => {
    request.current += 1; pending.current = false; setLoading(false);
  }, []);
  const reset = useCallback(() => {
    history.current = EMPTY_HISTORY; setPreview(null);
  }, []);
  const visit = useCallback(async (target: Target, index?: number) => {
    const id = ++request.current;
    onOpen();
    pending.current = true; setLoading(true);
    try {
      let next: Preview;
      if (target.kind === "file") {
        const data = await filePreviewApi.open(target.file);
        if (id !== request.current) { if (data) release(data); return true; }
        if (!data) return false;
        next = { kind: "file", data };
      } else next = target;
      history.current = index === undefined ? append(history.current, target) : { ...history.current, index };
      setPreview(next); onNavigate();
      return true;
    } catch (error) {
      if (id !== request.current) return true;
      throw error;
    } finally {
      if (id === request.current) { pending.current = false; setLoading(false); }
    }
  }, [onOpen, onNavigate]);
  const openFile = useCallback((file: FileTarget) => visit({ kind: "file", file }), [visit]);
  const openWebsite = useCallback((url: string) => { void visit({ kind: "website", url }); }, [visit]);
  const navigate = useCallback(async (direction: -1 | 1) => {
    if (pending.current) return;
    const index = history.current.index + direction;
    const target = history.current.entries[index];
    if (!target) return;
    let opened = false;
    try { opened = await visit(target, index); }
    catch { /* Keep the current preview and history available for another attempt. */ }
    if (!opened) void message.error({ content: guiText("预览未能打开，请稍后重试。"),
      style: { maxWidth: 400, marginInline: "auto" } });
  }, [visit]);
  useEffect(() => () => { request.current += 1; }, []);
  useEffect(() => {
    if (preview?.kind === "file") return () => release(preview.data);
  }, [preview]);
  return { preview, openFile, openWebsite, cancel, reset, navigation: {
    loading, canGoBack: !loading && history.current.index > 0,
    canGoForward: !loading && history.current.index < history.current.entries.length - 1,
    back: () => { void navigate(-1); }, forward: () => { void navigate(1); },
  } };
}
