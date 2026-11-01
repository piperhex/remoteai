import type { ProjectBrowserClient, ProjectDocument, ProjectWindowRequest } from './protocol';
import { browserError } from './useProjectTree';
import { projectRequestToken } from './requestToken';
import { normalizedPath, withinPath, type EntryRequest } from './entryActions';
import { editorGroups, editorLayoutIds, emptyGroup, mapEditorGroups, rebaseGroupPaths, removeGroupPaths,
  resizeEditorSplit, splitEditorGroup, type EditorLayout, type SplitDirection } from './editorGroups';

export interface DocumentTab {
  path: string;
  document?: ProjectDocument;
  text: string;
  loading: boolean;
  saving: boolean;
  error: string;
  saved: boolean;
  editorVersion: number;
  editedAt: number;
}

export const isDirty = (tab: DocumentTab) => tab.document?.kind === 'text' && tab.text !== tab.document.text;
export const canSave = (tab: DocumentTab) =>
  isDirty(tab) && !tab.loading && !tab.saving && !tab.document?.readOnly;

export interface DocumentsSnapshot {
  tabs: DocumentTab[]; activePath?: string; mutationPath?: string;
  layout?: EditorLayout; activeGroupId?: string;
}
interface WorkspaceSnapshot extends DocumentsSnapshot { layout: EditorLayout; activeGroupId: string }
interface EntryMutation { request: EntryRequest; path: string }

/** Owns independent drafts and request identities for one project browser. */
export class ProjectDocuments {
  private snapshot: WorkspaceSnapshot = { tabs: [], layout: emptyGroup(), activeGroupId: 'main' };
  private listeners = new Set<() => void>();
  private entryListeners = new Set<(change: EntryMutation) => Promise<void>>();
  private reads = new Map<string, AbortController>();

  constructor(private client: ProjectBrowserClient, private cwd: string, initial?: DocumentsSnapshot) {
    if (initial) this.snapshot = {
      ...initial, mutationPath: undefined, tabs: initial.tabs.map(tab => ({ ...tab, saving: false })),
      layout: initial.layout ?? { ...emptyGroup(), paths: initial.tabs.map(tab => tab.path),
        activePath: initial.activePath },
      activeGroupId: initial.activeGroupId ?? 'main',
    };
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  subscribeEntries = (listener: (change: EntryMutation) => Promise<void>) => {
    this.entryListeners.add(listener);
    return () => { this.entryListeners.delete(listener); };
  };
  private publish(snapshot: WorkspaceSnapshot) {
    const groups = editorGroups(snapshot.layout);
    const active = groups.find(group => group.id === snapshot.activeGroupId) ?? groups[0];
    this.snapshot = { ...snapshot, activeGroupId: active.id, activePath: active.activePath };
    this.listeners.forEach(listener => listener());
  }
  private update(path: string, changes: Partial<DocumentTab>) {
    this.publish({ ...this.snapshot,
      tabs: this.snapshot.tabs.map(tab => tab.path === path ? { ...tab, ...changes } : tab) });
  }
  get = (path?: string) => this.snapshot.tabs.find(tab => tab.path === path);
  resumeReads = () => {
    for (const tab of this.snapshot.tabs) {
      const needsRead = tab.loading || (!tab.document && !tab.error);
      if (needsRead && !this.reads.has(tab.path)) void this.reload(tab.path);
    }
  };
  focusGroup = (groupId: string) => {
    if (groupId !== this.snapshot.activeGroupId) this.publish({ ...this.snapshot, activeGroupId: groupId });
  };
  select = (path: string, groupId = this.snapshot.activeGroupId) => {
    if (!this.get(path)) return;
    const layout = mapEditorGroups(this.snapshot.layout, group => group.id !== groupId ? group : {
      ...group, paths: group.paths.includes(path) ? group.paths : [...group.paths, path], activePath: path,
    });
    this.publish({ ...this.snapshot, layout, activeGroupId: groupId });
  };
  open = async (path: string, groupId = this.snapshot.activeGroupId) => {
    if (this.snapshot.mutationPath) return;
    const existing = this.get(path);
    if (existing) {
      this.select(path, groupId);
      if (!existing.document && !existing.loading) await this.reload(path);
      return;
    }
    const tab: DocumentTab = { path, text: '', loading: true, saving: false, error: '', saved: false,
      editorVersion: 0, editedAt: 0 };
    this.publish({ ...this.snapshot, tabs: [...this.snapshot.tabs, tab] });
    this.select(path, groupId);
    await this.reload(path);
  };
  private release(document?: ProjectDocument) {
    if (document?.window) void this.client.release?.({ cwd: this.cwd, path: document.path,
      window: document.window }).catch(() => console.warn('Project view cleanup deferred until session expiry'));
  }
  page = async (path: string, direction: 'previous' | 'next' | 'first' | 'last') => {
    const tab = this.get(path);
    const window = tab?.document?.window;
    if (!tab || !window || tab.loading || tab.saving) return;
    const offsets = { previous: window.previous, next: window.end, first: 0,
      last: Math.max(0, tab.document!.size - 64 * 1024) };
    await this.reload(path, { token: window.token, offset: offsets[direction],
      ...(direction === 'previous' ? { end: window.offset } : {}) });
  };
  reload = async (path: string, window?: ProjectWindowRequest) => {
    const tab = this.get(path);
    if (!tab || tab.saving || this.snapshot.mutationPath) return;
    this.reads.get(path)?.abort();
    const request = new AbortController();
    this.reads.set(path, request);
    this.update(path, { loading: true, error: '' });
    try {
      const document = await this.client.read({ cwd: this.cwd, path, ...(window ? { window } : {}) }, request.signal);
      if (this.reads.get(path) !== request) return;
      if (!window) this.release(tab.document);
      this.update(path, { document, text: document.text ?? '', saved: false,
        editorVersion: tab.editorVersion + 1, editedAt: 0 });
    } catch (failure) {
      if (this.reads.get(path) === request) this.update(path, { error: browserError(failure) });
    } finally {
      if (this.reads.get(path) === request) { this.reads.delete(path); this.update(path, { loading: false }); }
    }
  };
  edit = (path: string, text: string) => {
    const tab = this.get(path);
    if (tab && !tab.loading && !tab.document?.readOnly) this.update(path, { text, saved: false, editedAt: Date.now() });
  };
  save = async (path: string): Promise<boolean> => {
    if (this.snapshot.mutationPath) return false;
    const tab = this.get(path);
    if (!tab || !canSave(tab) || !tab.document) return false;
    this.update(path, { saving: true, error: '', saved: false });
    try {
      const document = await this.client.save({
        cwd: this.cwd, path: tab.document.path, text: tab.text, revision: tab.document.revision,
        ...(tab.document.window ? { window: tab.document.window } : {}),
      });
      // Saving updates only the baseline; typing and switching tabs may continue during the request.
      this.update(path, { document, saved: true });
      return true;
    } catch (failure) {
      this.update(path, { error: browserError(failure) });
      return false;
    } finally { this.update(path, { saving: false }); }
  };
  saveAll = async (paths: string[]) => {
    for (const path of paths) {
      const tab = this.get(path);
      if (tab && isDirty(tab) && !await this.save(path)) return false;
    }
    return paths.every(path => { const tab = this.get(path); return !tab || !isDirty(tab); });
  };
  close = (path: string, groupId = this.snapshot.activeGroupId) => { this.closeTabs(groupId, [path]); };
  closeTabs = (groupId: string, paths: string[]) => {
    if (this.snapshot.mutationPath || paths.some(path => this.get(path)?.saving)) return;
    const layout = removeGroupPaths(this.snapshot.layout, groupId, paths);
    const visible = new Set(editorGroups(layout).flatMap(group => group.paths));
    for (const path of paths) {
      if (!visible.has(path)) {
        this.reads.get(path)?.abort(); this.reads.delete(path); this.release(this.get(path)?.document);
      }
    }
    this.publish({ ...this.snapshot, layout, tabs: this.snapshot.tabs.filter(tab => visible.has(tab.path)) });
  };
  lastViews = (groupId: string, paths: string[]) => {
    const elsewhere = new Set(editorGroups(this.snapshot.layout).filter(group => group.id !== groupId)
      .flatMap(group => group.paths));
    return paths.filter(path => !elsewhere.has(path));
  };
  split = (options: { groupId: string; path: string; direction: SplitDirection; move: boolean }) => {
    if (this.snapshot.mutationPath || !this.get(options.path)) return;
    const groups = editorGroups(this.snapshot.layout);
    if (!groups.some(group => group.id === options.groupId && group.paths.includes(options.path))) return;
    const ids = new Set(editorLayoutIds(this.snapshot.layout));
    let next = 1;
    while (ids.has(`group-${next}`) || ids.has(`split-group-${next}`)) next += 1;
    const id = `group-${next}`;
    const layout = splitEditorGroup(this.snapshot.layout, { ...options, id });
    this.publish({ ...this.snapshot, layout, activeGroupId: id });
  };
  resizeSplit = (id: string, ratio: number) => {
    if (!Number.isFinite(ratio)) return;
    this.publish({ ...this.snapshot, layout: resizeEditorSplit(this.snapshot.layout, id,
      Math.max(0.1, Math.min(0.9, ratio))) });
  };

  /** Pause autosave across a tree mutation and rebase all affected drafts together. */
  mutate = async (request: EntryRequest) => {
    if (this.snapshot.mutationPath || this.snapshot.tabs.some(tab => tab.saving || tab.loading)) {
      throw new Error('文件正在读写，请稍后重试。');
    }
    if (request.action === 'copy'
      && this.snapshot.tabs.some(tab => withinPath(tab.path, request.path) && isDirty(tab))) {
      throw new Error('请先保存此文件或文件夹中的修改，再复制。');
    }
    this.publish({ ...this.snapshot, mutationPath: request.path });
    try {
      const result = await this.client.mutate(request);
      if (request.action === 'rename' || request.action === 'move' || request.action === 'delete') {
        await this.applyEntryChange(request, result.path);
      }
      await Promise.all([...this.entryListeners].map(listener => listener({ request, path: result.path })));
      return result;
    } finally { this.publish({ ...this.snapshot, mutationPath: undefined }); }
  };
  private async applyEntryChange(request: EntryRequest, destination: string) {
    const affected = (path: string) => withinPath(path, request.path);
    const rebase = (path: string) => affected(path)
      ? normalizedPath(destination) + normalizedPath(path).slice(normalizedPath(request.path).length) : path;
    let tabs = this.snapshot.tabs;
    const moved = tabs.filter(tab => affected(tab.path) && tab.document?.window);
    for (const tab of moved) this.release(tab.document);
    if (request.action === 'delete') tabs = tabs.filter(tab => !affected(tab.path));
    else tabs = tabs.map(tab => !affected(tab.path) ? tab : {
      ...tab, path: rebase(tab.path),
      document: tab.document ? { ...tab.document, path: rebase(tab.document.path) } : undefined,
    });
    const layout = rebaseGroupPaths(this.snapshot.layout,
      path => request.action === 'delete' && affected(path) ? undefined : rebase(path));
    this.publish({ ...this.snapshot, tabs, layout });
    if (request.action !== 'delete') {
      for (const tab of moved) await this.rebindWindow(tab, rebase(tab.path));
    }
  }
  private async rebindWindow(tab: DocumentTab, path: string) {
    const previous = tab.document!;
    try {
      const document = await this.client.read({ cwd: this.cwd, path,
        window: { ...previous.window!, token: projectRequestToken(), open: true } });
      if (document.revision !== previous.revision) {
        this.release(document);
        throw new Error('client.projectBrowser.thisFileChangedElsewhereCopyYourEditsBeforeReloadingIt');
      }
      // Only the saved baseline changes. An unsaved page survives moving its file or parent folder.
      this.update(path, { document });
    } catch (failure) {
      this.update(path, { error: browserError(failure), document: { ...previous, path, readOnly: true } });
    }
  }
}
