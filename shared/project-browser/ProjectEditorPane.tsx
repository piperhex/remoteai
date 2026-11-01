import { ArrowLeft, FileSearch, RefreshCw, Save, Settings2 } from 'lucide-react';
import { ProjectTabs } from './ProjectTabs';
import { ProjectFilePanel } from './ProjectFilePanel';
import { isDirty, type ProjectDocuments } from './documents';
import type { EditorGroup } from './editorGroups';
import type { BrowserTranslate } from './ProjectTree';
import type { useTabActions } from './useTabActions';
import { frameStyle, type EditorFrame } from './editorLayout';
import type { BrowserHost } from './entryActions';
import type { ProjectPreviewRenderer } from './preview';
import type { ProjectBlame } from './protocol';
import { BrowserFullscreenButton } from './browserFullscreen';

export interface EditorPaneOptions {
  store: ProjectDocuments; connected: boolean; t: BrowserTranslate;
  actions: ReturnType<typeof useTabActions>; back: () => void; settings: () => void; settingsOpen: boolean;
  quoteSelection?: BrowserHost['quoteSelection'];
  renderPreview?: ProjectPreviewRenderer;
  runScripts?: boolean;
  blame?: (path: string, revision: string) => Promise<ProjectBlame>;
}

export function ProjectEditorPane({ group, frame, options }: {
  group: EditorGroup; frame: EditorFrame; options: EditorPaneOptions;
}) {
  const { store, connected, t, actions } = options;
  const tabs = group.paths.flatMap(path => { const tab = store.get(path); return tab ? [tab] : []; });
  const active = store.get(group.activePath);
  const blocked = !!store.getSnapshot().mutationPath || !!actions.pending || actions.busy;
  const save = () => { if (connected && active && !blocked) void store.save(active.path); };
  return <section className="pf-editor-pane" data-group={group.id}
    data-active={group.id === store.getSnapshot().activeGroupId} style={frameStyle(frame)}
    aria-label={t("client.projectBrowser.editorPane")} onPointerDownCapture={() => store.focusGroup(group.id)}
    onFocusCapture={() => store.focusGroup(group.id)}>
    <header className="pf-file-heading">
      <div className="pf-file-toolbar">
        <button type="button" className="pf-back" aria-label={t("client.projectBrowser.backToFiles")} onClick={options.back}>
          <ArrowLeft size={18} /></button>
        <div className="pf-file-name">
          {tabs.length ? <ProjectTabs tabs={tabs} activePath={group.activePath} groupId={group.id} blocked={blocked}
            connected={connected} choose={path => store.select(path, group.id)}
            close={path => actions.close({ groupId: group.id, path })} command={actions.command} t={t} />
            : <strong>{t("client.workspaceActions.fileContent")}</strong>}
        </div>
        <button type="button" aria-label={t("client.projectBrowser.fileBrowserSettings")} aria-expanded={options.settingsOpen}
          onClick={options.settings}><Settings2 size={16} /></button>
        {active && <button type="button" aria-label={t("client.projectBrowser.reloadFile")}
          disabled={active.loading || active.saving || !connected || blocked}
          onClick={() => actions.guard([active.path], () => { void store.reload(active.path); })}>
          <RefreshCw size={16} /></button>}
        {active?.document?.kind === 'text' && <button type="button"
          aria-label={t(active.saving ? "client.projectBrowser.saving" : "client.projectBrowser.save")} aria-busy={active.saving}
          title={t(active.saving ? "client.projectBrowser.saving" : "client.projectBrowser.save")}
          disabled={!connected || !isDirty(active) || active.document.readOnly
            || active.loading || active.saving || blocked}
          onClick={save}><Save size={16} aria-hidden="true" /></button>}
        <BrowserFullscreenButton t={t} className="pf-fullscreen-heading" />
      </div>
    </header>
    {!active && <div className="pf-empty"><FileSearch size={36} /><p>{t("client.projectBrowser.selectAFileToViewItsContents")}</p></div>}
    {tabs.map(tab => <ProjectFilePanel key={tab.path} tab={tab} active={tab.path === group.activePath}
      connected={connected} edit={text => store.edit(tab.path, text)}
      prepareScript={options.runScripts ? async () => connected && !blocked && await store.saveAll([tab.path]) : undefined}
      quoteSelection={options.quoteSelection}
      renderPreview={options.renderPreview}
      blame={options.blame}
      openFile={path => { void store.open(path, group.id); }}
      page={direction => actions.guard([tab.path], () => { void store.page(tab.path, direction); })}
      save={() => { if (connected && !blocked) void store.save(tab.path); }} t={t} />)}
  </section>;
}
