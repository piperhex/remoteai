import { createRoot } from 'react-dom/client';
import { WebLocaleProvider } from '../src/i18n/WebLocaleProvider';
import { initializeTheme } from '../src/theme/preference';
import { ChatFilePreview, type FilePreviewContext } from '../src/chat/ChatFilePreview';
import { ChatFileContext } from '../src/chat/ChatFileLink';
import { ChatDetailsWorkspace } from '../src/chat/ChatDetailsWorkspace';
import { ChatMarkdown } from '../src/chat/ChatMarkdown';
import { PcFilePreviewFixture } from './pc-file-preview-fixture';
import { externalCodePath, longMarkdown, markdown, sourceCode } from './file-preview-fixture';
import { HTML_FIXTURE_ASSETS, HTML_FIXTURE_DOCUMENT, HTML_FIXTURE_PATH } from '../../../shared/file-preview/htmlPreviewFixture';
import 'antd/dist/reset.css';
import 'antd-mobile/es/global';
import '../src/styles.css';
import '../src/chat/chat.css';
import '../src/chat/messages.css';
import '../src/chat/desktopMessages.css';

initializeTheme();
const params = new URLSearchParams(location.search);
const DOWNLOAD_BYTES = 8 * 1024 * 1024;
Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });

const files: Record<string, string> = {
  [HTML_FIXTURE_PATH]: params.has('external')
    ? HTML_FIXTURE_DOCUMENT.replaceAll('images/preview%20image.svg', new URL('slow-photo.svg', location.href).href)
    : HTML_FIXTURE_DOCUMENT,
  'F:/remote/docs/handoff.md': markdown + '\n\n[后续文档](next.md#L3)',
  'F:/remote/docs/next.md': '# 后续文档\n\n这是同一台远程电脑上的文件。',
  'verification.md': markdown, 'README.MARKDOWN': markdown, 'long.md': longMarkdown,
  'empty.md': ' \n', 'source.ts': sourceCode, [externalCodePath]: sourceCode,
  'page.HTML': '<h1>页面预览</h1><script>document.body.dataset.ready = "yes";'
    + 'try { parent.previewScriptRan = true } catch {}'
    + 'try { localStorage.setItem("unsafe", "yes") } catch {}'
    + '</script>',
};
const assets = new Map<string, Uint8Array>();
let assetId = 0;
const context: FilePreviewContext = {
  threadId: 'file-preview', ready: params.get('download') !== 'offline',
  load: async (_threadId, path) => {
    if (!(path in files)) throw new Error('File unavailable');
    return { path, text: files[path] };
  },
  client: {
    open: async (_threadId, path) => {
      if (params.get('download') === 'error') throw new Error('Download unavailable');
      if (params.has('assets')) {
        const asset = HTML_FIXTURE_ASSETS[path.replace('F:/preview test/页面/', '')];
        if (!asset || params.has('missing') && asset.mime.startsWith('image/')) throw new Error('Missing asset');
        const id = `11111111-1111-4111-8111-${String(assetId++).padStart(12, '0')}`;
        const bytes = new TextEncoder().encode(asset.text); assets.set(id, bytes);
        return { id, size: bytes.length, name: path.split('/').at(-1)!, mimeType: asset.mime };
      }
      return { id: '11111111-1111-4111-8111-111111111111', size: DOWNLOAD_BYTES,
        name: path.split(/[\\/]/).at(-1)!, mimeType: 'application/octet-stream' };
    },
    read: async ({ id, offset, length }) => {
      if (params.has('assets')) {
        await new Promise(resolve => setTimeout(resolve, Number(params.get('delay') || 100)));
        return { offset, data: btoa(String.fromCharCode(...assets.get(id)!.slice(offset, offset + length))) };
      }
      await new Promise(resolve => setTimeout(resolve, Number(params.get('delay') || 600)));
      return { offset, data: btoa('A'.repeat(length)) };
    },
    close: async (_threadId, id) => { assets.delete(id); },
  },
};
const path = params.get('path') ?? 'verification.md';
createRoot(document.getElementById('root')!).render(
  <WebLocaleProvider>{params.has('pc') ? <PcFilePreviewFixture legacy={params.has('legacy')} />
  : params.has('workspace') ? <div className="chat-page" style={{ height: '100dvh' }}>
    <ChatFileContext.Provider value={context}>
      <ChatDetailsWorkspace selected={context.threadId} active enabled>
        <ChatMarkdown text="[交接文档](F:/remote/docs/handoff.md)" />
      </ChatDetailsWorkspace>
    </ChatFileContext.Provider>
  </div> : <ChatFilePreview path={path} line={3} context={context} onClose={() => {}} />}</WebLocaleProvider>,
);
