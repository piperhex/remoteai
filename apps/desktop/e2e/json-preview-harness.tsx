import { useContext, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { DetailsWorkspace } from '../../../shared/conversation/DetailsWorkspace';
import { DetailsContext } from '../../../shared/conversation/detailsContext';
import { FileEnvironmentContext, type FileEnvironment } from '../../../shared/conversation/fileEnvironment';
import { filePreviewApi } from '../../../shared/file-preview/workspace/api';
import { fileApi } from '../../../shared/conversation/fileApi';
import { ProjectBrowserSettingsCard } from '../src/pages/settings/ProjectBrowserSettingsCard';
import { ChatDetailsWorkspace } from '../../../shared/remote-chat/views/ChatDetailsWorkspace';
import { ChatFileContext } from '../../../shared/remote-chat/views/ChatFileLink';
import { JsonHighlightSettings } from '../../../shared/file-preview/JsonHighlightSettings';
import { displayText } from '../../../shared/localization/messages';
import { useLanguage, setLanguage } from '../../../shared/localization/browserClient';
import { MEBIBYTE } from '../../../shared/file-preview/jsonHighlightLimit';
import '../src/styles.css';
import '../../../shared/remote-chat/views/chat.css';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'local';
const bytes = Number(params.get('mb') ?? 1.5) * MEBIBYTE;
const row = '  "entry": "' + '中文 content '.repeat(70) + '",\n';
const rows = Math.floor((bytes - 20) / new TextEncoder().encode(row).length);
const generated = params.has('nested') ? JSON.stringify({ models: [
  { name: 'first-model', options: { enabled: true } }, { name: 'second-model', options: { enabled: false } },
], last: true }, null, 2) : '{\n' + row.repeat(rows) + '  "last": true\n}';
let text = params.has('nested') ? generated
  : generated + ' '.repeat(Math.max(0, Math.floor(bytes) - new TextEncoder().encode(generated).length));
if (params.has('newlines')) {
  text = '{\r\n  "first": {\r\n    "name": "first-model"\r\n  },\r\n  "last": true\r\n}';
  if (params.get('newlines') === 'mixed') text = text.replace('"first": {\r\n', '"first": {\n');
  if (params.get('newlines') === 'cr') text = text.replaceAll('\r\n', '\r');
}
const initialLine = params.has('nested') ? 3 : 600;
const target = { path: 'C:/project/models.json', threadId: 'fixture',
  line: params.has('newlines') ? 5 : initialLine };
const data = { ...target, sessionId: 'json-preview', name: 'models.json', kind: 'text' as const, text,
  size: new TextEncoder().encode(text).length, url: 'http://127.0.0.1/json-preview/models.json' };
filePreviewApi.open = async requested => ({ ...data, ...requested });
filePreviewApi.close = async () => {};
fileApi.applications = async () => [];
fileApi.perform = async () => ({ path: target.path, saved: false });
const environment: FileEnvironment = {
  remote: true, previews: filePreviewApi, actions: fileApi,
  resolveWebsite: async url => url, image: () => null,
};
const files = { ready: true, threadId: 'fixture', load: async () => data,
  client: { open: async () => { throw new Error('Unused download'); },
    read: async () => ({ offset: 0, data: '' }), close: async () => {} } };

function Controls() {
  useLanguage();
  const context = useContext(DetailsContext)!;
  const open = mode === 'legacy' ? context.openRemoteFile ?? context.openFile : context.openFile;
  useEffect(() => { void open(target); }, [open]);
  return <div style={{ padding: 24, maxWidth: 400 }}>
    {mode === 'web' || mode === 'legacy' ? <JsonHighlightSettings t={displayText} /> : <ProjectBrowserSettingsCard />}
    <button onClick={() => setLanguage('en')}>English</button>
    <button onClick={() => setLanguage('ja')}>日本語</button>
    <button onClick={() => setLanguage('zh')}>中文</button>
    <button onClick={() => void open({ ...target, line: rows + 2 })}>Last line</button>
  </div>;
}

function Harness() {
  const content = mode === 'web' || mode === 'legacy'
    ? <ChatDetailsWorkspace selected="fixture" active enabled><Controls /></ChatDetailsWorkspace>
    : <DetailsWorkspace selected="fixture" active><Controls /></DetailsWorkspace>;
  return <div style={{ height: '100vh' }}>
    <FileEnvironmentContext.Provider value={mode === 'local' ? null : environment}>
      <ChatFileContext.Provider value={files}>{content}</ChatFileContext.Provider>
    </FileEnvironmentContext.Provider>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
