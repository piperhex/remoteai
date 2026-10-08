import { createRoot } from 'react-dom/client';
import { ChatFilePreview, type FilePreviewContext } from '../src/chat/ChatFilePreview';
import { externalCodePath, longMarkdown, markdown, sourceCode } from './file-preview-fixture';
import '../src/styles.css';
import '../src/chat/chat.css';
import '../src/chat/messages.css';

const params = new URLSearchParams(location.search);
const DOWNLOAD_BYTES = 8 * 1024 * 1024;
Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });

const files: Record<string, string> = {
  'verification.md': markdown, 'README.MARKDOWN': markdown, 'long.md': longMarkdown,
  'empty.md': ' \n', 'source.ts': sourceCode, [externalCodePath]: sourceCode,
  'page.HTML': '<h1>页面预览</h1><script>document.body.dataset.ready = "yes";'
    + 'try { parent.previewScriptRan = true } catch {}'
    + 'try { localStorage.setItem("unsafe", "yes") } catch {}'
    + '</script>',
};
const context: FilePreviewContext = {
  threadId: 'file-preview', ready: params.get('download') !== 'offline',
  load: async (_threadId, path) => {
    if (!(path in files)) throw new Error('File unavailable');
    return { path, text: files[path] };
  },
  client: {
    open: async (_threadId, path) => {
      if (params.get('download') === 'error') throw new Error('Download unavailable');
      return { id: '11111111-1111-4111-8111-111111111111', size: DOWNLOAD_BYTES,
        name: path.split(/[\\/]/).at(-1)!, mimeType: 'application/octet-stream' };
    },
    read: async ({ offset, length }) => {
      await new Promise(resolve => setTimeout(resolve, Number(params.get('delay') || 600)));
      return { offset, data: btoa('A'.repeat(length)) };
    },
    close: async () => {},
  },
};
const path = params.get('path') ?? 'verification.md';
createRoot(document.getElementById('root')!).render(
  <ChatFilePreview path={path} line={3} context={context} onClose={() => {}} />,
);
