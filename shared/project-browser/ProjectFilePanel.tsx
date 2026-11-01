import { remoteErrorText } from '../localization/errors';
import { FileSearch } from 'lucide-react';
import { ProjectWindowNavigation } from './ProjectWindowNavigation';
import { ProjectEditor } from './ProjectEditor';
import { isDirty, type DocumentTab } from './documents';
import type { BrowserTranslate } from './ProjectTree';
import type { BrowserHost } from './entryActions';
import type { ProjectPreviewRenderer } from './preview';
import type { EditorPaneOptions } from './ProjectEditorPane';

export function ProjectFilePanel({ tab, active, connected, edit, save, t, quoteSelection, renderPreview, openFile,
  prepareScript, blame, page }: {
  tab: DocumentTab; active: boolean; connected: boolean; edit: (text: string) => void;
  save: () => void; t: BrowserTranslate;
  quoteSelection?: BrowserHost['quoteSelection'];
  renderPreview?: ProjectPreviewRenderer;
  openFile: (path: string) => void;
  prepareScript?: () => Promise<boolean>;
  blame?: EditorPaneOptions['blame'];
  page: (direction: 'previous' | 'next' | 'first' | 'last') => void;
}) {
  const document = tab.document;
  const filename = tab.path.split(/[\\/]/).at(-1);
  const editor = document?.kind === 'text' && <ProjectEditor key={tab.editorVersion} path={document.path}
    text={tab.text} bounded={document.bounded} windowed={!!document.window}
    readOnly={document.readOnly || !connected || tab.loading}
    onChange={edit} save={save} t={t} quoteSelection={active ? quoteSelection : undefined}
    prepareScript={document.window ? undefined : prepareScript} blame={blame && !document.window ? { read: revision => blame(document.path, revision),
      text: document.text ?? '', revision: document.revision, connected } : undefined} />;
  const preview = document && !document.window && renderPreview?.({ document, text: tab.text, active, connected, editor, openFile });
  return <div className="pf-file-panel" role="tabpanel" aria-label={filename} hidden={!active}>
    {tab.error && <div className="pf-feedback" role="alert">{remoteErrorText(tab.error)}</div>}
    {tab.loading && <p className="pf-feedback" role="status">{t("client.projectBrowser.loading")}</p>}
    {document?.window && <ProjectWindowNavigation document={document} t={t} page={page}
      disabled={!connected || tab.loading || tab.saving} />}
    {preview || <>{editor}
    {document?.kind === 'image' && <div className="pf-image"><img src={document.image} alt={filename} /></div>}
    {document && ['binary', 'large'].includes(document.kind) && <div className="pf-empty">
      <FileSearch size={36} /><p>{t(document.kind === 'large'
        ? "client.projectBrowser.largeImagePreview" : "client.projectBrowser.previewIsNotAvailableForThisFile")}</p></div>}</>}
    {document && <footer className="pf-status" role="status">
      <span>{Math.max(1, Math.ceil(document.size / 1024))} KB</span>
      <span>{t(document.readOnly ? "client.projectBrowser.readOnly" : isDirty(tab) ? "client.projectBrowser.unsaved" : tab.saved ? "client.configHelp.saved" : "client.projectBrowser.editable")}</span>
    </footer>}
  </div>;
}
