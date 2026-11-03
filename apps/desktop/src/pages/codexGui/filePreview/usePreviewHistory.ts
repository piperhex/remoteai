import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { message } from "antd";
import { uiText } from "../../../i18n/uiText";
import { filePreviewApi, type FilePreviewData } from "./api";
import { FileEnvironmentContext } from '../fileEnvironment';
import { useWebsiteTabs } from './useWebsiteTabs';
import type { ManagedBrowserTab } from '../../../../../../shared/browser/automation';
import { fileResourceKey, RemoteBrowserResourceContext, type BrowserResource } from './browserResources';
import { fileBrowserResource } from './fileResource';
import { downloadBrowserResource } from './downloadResource';

export type FilePreviewTarget = Parameters<typeof filePreviewApi.open>[0];
/** Already resolved URLs belong to the viewing computer, including when revisiting history. */
export interface WebsitePreviewOptions { resolved?: boolean }
export interface FilePreviewOptions { browser?: boolean }
type RemoteFile = { kind: "remoteFile"; file: FilePreviewTarget };
type Target = ({ kind: "file"; file: FilePreviewTarget } & FilePreviewOptions) | RemoteFile
  | ({ kind: "website"; url: string } & WebsitePreviewOptions);
type Preview = { kind: "file"; data: FilePreviewData; release: () => void }
  | RemoteFile | { kind: "website"; url: string };
interface History { entries: Target[]; index: number }
const EMPTY_HISTORY: History = { entries: [], index: -1 };
const MAX_HISTORY_ENTRIES = 100;

function sameTarget(current: Target | undefined, next: Target) {
  if (current?.kind === "website" && next.kind === "website") {
    return current.url === next.url && Boolean(current.resolved) === Boolean(next.resolved);
  }
  if (!current || current.kind === "website" || next.kind === "website" || current.kind !== next.kind) return false;
  if (current.kind === 'file' && next.kind === 'file' && Boolean(current.browser) !== Boolean(next.browser)) return false;
  return current.file.path === next.file.path && current.file.threadId === next.file.threadId
    && current.file.line === next.file.line && current.file.column === next.file.column;
}

function append(history: History, target: Target): History {
  if (sameTarget(history.entries[history.index], target)) return history;
  const entries = [...history.entries.slice(0, history.index + 1), target].slice(-MAX_HISTORY_ENTRIES);
  return { entries, index: entries.length - 1 };
}

async function readPreview(options: {
  target: Extract<Target, { kind: 'file' }>; api: typeof filePreviewApi;
  current: () => boolean; openResource: (resource: BrowserResource) => void; remoteFallback: boolean;
}): Promise<Preview | null | undefined> {
  const { target, api } = options;
  const data = await api.open(target.file);
  const release = () => { if (data) void api.close(data.sessionId)
    .catch(error => console.error('Failed to release file preview', error)); };
  if (!options.current()) { release(); return undefined; }
  if (!data && options.remoteFallback) return null;
  if (!target.browser) return data ? { kind: 'file', data, release } : null;
  const resource = data ? fileBrowserResource({ data, key: fileResourceKey(target.file), api, target: target.file })
    : downloadBrowserResource(target.file);
  options.openResource(resource);
  return { kind: 'website', url: resource.url };
}

export function usePreviewHistory({ onOpen, onNavigate }: { onOpen: () => void; onNavigate: () => void }) {
  const environment = useContext(FileEnvironmentContext);
  const remoteResource = useContext(RemoteBrowserResourceContext);
  const api = environment?.previews ?? filePreviewApi;
  const websites = useWebsiteTabs();
  const resetWebsites = websites.reset;
  const openWebsiteTab = websites.open;
  const adoptWebsite = websites.adopt;
  const openResourceTab = websites.openResource;
  const selectResource = websites.selectResource;
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
    history.current = EMPTY_HISTORY; setPreview(null); resetWebsites();
  }, [resetWebsites]);
  const visit = useCallback(async (target: Target, index?: number) => {
    const id = ++request.current;
    onOpen();
    if (target.kind === 'website') {
      openWebsiteTab(target.url, target.resolved);
      history.current = index === undefined ? append(history.current, target) : { ...history.current, index };
      pending.current = false; setLoading(false); setPreview(target); onNavigate(); return true;
    }
    const resourceKey = fileResourceKey(target.file);
    const browserFile = target.kind === 'file' ? target.browser : Boolean(remoteResource);
    const resourceUrl = browserFile ? selectResource(resourceKey) : undefined;
    if (resourceUrl) {
      history.current = index === undefined ? append(history.current, target) : { ...history.current, index };
      pending.current = false; setLoading(false); setPreview({ kind: 'website', url: resourceUrl });
      onNavigate(); return true;
    }
    if (!browserFile && sameTarget(history.current.entries[history.current.index], target)) {
      pending.current = false; setLoading(false); onNavigate(); return true;
    }
    pending.current = true; setLoading(true);
    try {
      let next: Preview | null | undefined = target.kind === 'file' ? await readPreview({ target, api,
        current: () => id === request.current, openResource: openResourceTab,
        remoteFallback: Boolean(environment && remoteResource) }) : target;
      if (target.kind === 'remoteFile' && remoteResource) {
        const resource = remoteResource(target.file); openResourceTab(resource);
        next = { kind: 'website', url: resource.url };
      }
      if (next === undefined) return true;
      if (next === null) return false;
      history.current = index === undefined ? append(history.current, target) : { ...history.current, index };
      setPreview(next); onNavigate();
      return true;
    } catch (error) {
      if (id !== request.current) return true;
      throw error;
    } finally {
      if (id === request.current) { pending.current = false; setLoading(false); }
    }
  }, [onOpen, onNavigate, api, openWebsiteTab, openResourceTab, selectResource, environment, remoteResource]);
  const openFile = useCallback((file: FilePreviewTarget, options: FilePreviewOptions = {}) =>
    visit({ kind: "file", file, browser: options.browser }), [visit]);
  const openRemoteFile = useCallback((file: FilePreviewTarget) => visit({ kind: "remoteFile", file }), [visit]);
  const openWebsite = useCallback((url: string, options: WebsitePreviewOptions = {}) => {
    void visit({ kind: "website", url, resolved: options.resolved }).catch(() => { void message.error({
      content: uiText("client.conversation.couldNotOpenTheLinkPleaseTryAgainShortly"), style: { maxWidth: 400, marginInline: "auto" },
    }); });
  }, [visit]);
  const openManagedWebsite = useCallback((tab: ManagedBrowserTab) => {
    cancel(); onOpen(); adoptWebsite(tab); setPreview({ kind: 'website', url: tab.url }); onNavigate();
  }, [cancel, onOpen, adoptWebsite, onNavigate]);
  const openResource = useCallback((resource: BrowserResource) => {
    cancel(); onOpen(); openResourceTab(resource); setPreview({ kind: 'website', url: resource.url }); onNavigate();
  }, [cancel, onOpen, openResourceTab, onNavigate]);
  const navigate = useCallback(async (direction: -1 | 1) => {
    if (pending.current) return;
    const index = history.current.index + direction;
    const target = history.current.entries[index];
    if (!target) return;
    let opened = false;
    try { opened = await visit(target, index); }
    catch { /* Keep the current preview and history available for another attempt. */ }
    if (!opened) void message.error({ content: uiText("client.workspaceActions.couldNotOpenThePreviewPleaseTryAgainShortly"),
      style: { maxWidth: 400, marginInline: "auto" } });
  }, [visit]);
  // Reset the owning computer before child effects can open a preview in the new workspace.
  useLayoutEffect(() => { cancel(); reset(); return cancel; }, [api, cancel, reset]);
  useEffect(() => {
    if (preview?.kind === "file") return preview.release;
  }, [preview]);
  return { preview, websites, openFile, openRemoteFile, openWebsite, openManagedWebsite, openResource, cancel, reset,
    hasFileHistory: history.current.entries.some(target => target.kind !== 'website'), navigation: {
    loading, canGoBack: !loading && history.current.index > 0,
    canGoForward: !loading && history.current.index < history.current.entries.length - 1,
    back: () => { void navigate(-1); }, forward: () => { void navigate(1); },
  } };
}
