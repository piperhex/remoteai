import { useContext, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { fromByteArray } from 'base64-js';
import { DetailsWorkspace } from '../../../shared/conversation/DetailsWorkspace';
import { DetailsContext } from '../../../shared/conversation/detailsContext';
import { ChatDetailsWorkspace } from '../../../shared/remote-chat/views/ChatDetailsWorkspace';
import { ChatRemoteFilePreview } from '../../../shared/remote-chat/views/ChatRemoteFilePreview';
import { RichText } from '../../../shared/conversation/RichText';
import { ChatMarkdown } from '../../../shared/remote-chat/views/ChatMarkdown';
import { FileEnvironmentContext, type FileEnvironment } from '../../../shared/conversation/fileEnvironment';
import { FileThreadContext, fileApi } from '../../../shared/conversation/fileApi';
import { filePreviewApi } from '../../../shared/file-preview/workspace/api';
import { BrowserClientContext } from '../../../shared/file-preview/workspace/browserClient';
import { ChatFileContext } from '../../../shared/remote-chat/views/ChatFileLink';
import { ChatImage, ChatImageContext } from '../../../shared/remote-chat/views/ChatImage';
import { guiApi } from '../../../shared/conversation/api';
import { ImageThreadContext } from '../../../shared/conversation/useImageSource';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { filePreviewKind } from '../../../shared/file-preview/kinds';
import type { FileClient } from '../../../shared/remote-chat/fileDownload';
import { setGuiLanguage } from '../../../shared/localization/uiText';
import { useThemeMode } from '../src/hooks/useThemeMode';
import '../src/styles.css';
import 'antd/dist/reset.css';
import '../../../shared/remote-chat/views/messages.css';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'local';
Object.defineProperty(globalThis, 'isTauri', { value: mode === 'local', configurable: true });
localStorage.setItem('codex-switch:theme-mode', params.has('dark') ? 'dark' : 'light');
setGuiLanguage('zh');
Object.assign(window, { setPreviewLanguage: setGuiLanguage });
const names = ['page.html', 'image.svg', 'video.mp4', 'sound.wav', 'report.PDF', 'guide.md',
  'settings.json', 'archive.zip', 'setup.exe', '项目资源与动画素材归档-用于检查较长文件名称在窄窗口中的换行显示.zip'];
const address = (path: string) => new URL(`/resource/${path.split(/[\\/]/).at(-1)}`, location.href).href;
filePreviewApi.open = async target => {
  document.body.dataset.previewReads = String(Number(document.body.dataset.previewReads ?? 0) + 1);
  if (params.has('previewUnavailable')) throw new Error('Preview tunnel unavailable');
  const response = await fetch(address(target.path));
  const kind = filePreviewKind(target.path) ?? 'text';
  return { ...target, kind, name: target.path.split('/').at(-1)!, sessionId: crypto.randomUUID(),
    url: response.url, text: ['html', 'markdown', 'text'].includes(kind) ? await response.text() : null };
};
filePreviewApi.close = async id => { document.body.dataset.closed = id; };
fileApi.applications = async () => [];
fileApi.perform = async (target, action) => {
  document.body.dataset.action = JSON.stringify({ target, action });
  return { path: target.path, saved: true };
};
const environment: FileEnvironment = { remote: true, previews: filePreviewApi, actions: fileApi,
  resolveWebsite: async () => { throw new Error('File resources must not resolve as remote websites'); },
  image: props => <ChatImage source={props.src} description={props.alt} /> };
const transfers = new Map<string, Uint8Array>();
document.body.dataset.transfers = '0';
const client: FileClient = {
  open: async (_thread, path) => {
    const response = await fetch(address(path));
    const bytes = new Uint8Array(await response.arrayBuffer());
    const id = crypto.randomUUID(); transfers.set(id, bytes);
    document.body.dataset.transfers = String(transfers.size);
    return { id, size: bytes.length, name: path.split('/').at(-1)!, mimeType: response.headers.get('Content-Type')! };
  },
  read: async ({ id, offset, length }) => ({ offset,
    data: fromByteArray(transfers.get(id)!.subarray(offset, offset + length)) }),
  close: async (_thread, id) => { transfers.delete(id); document.body.dataset.transfers = String(transfers.size); },
};
const load = async (_thread: string, path: string) => {
  document.body.dataset.textRead = path;
  if (filePreviewKind(path) === 'pdf') throw new Error('PDF must not use text preview');
  return { path, text: await (await fetch(address(path))).text() };
};
const browser = { native: false, request: async () => ({ tabs: [] }), subscribe: async () => () => {} };
const imageLoad = async (_thread: string, source: string, original = false): Promise<string> => {
  const response = await fetch('/image-preview.json', { method: 'POST',
    body: JSON.stringify({ source, original }) });
  return (await response.json()).url;
};
if (params.has('source')) guiApi.request = async <T,>(request: Parameters<typeof guiApi.request>[0]) => {
  if (request.operation !== 'imagePreview') throw new Error('Unexpected image fixture request');
  return { url: await imageLoad('resource-thread', request.source, request.variant === 'original') } as T;
};

function PdfEntries({ threadId }: { threadId: string }) {
  const details = useContext(DetailsContext);
  if (!details) return null;
  const target = { path: 'C:/project/report.PDF', threadId };
  return <div>
    <button onClick={() => { void details.openFile(target); }}>默认入口 PDF</button>
    <button onClick={() => { void details.openFile(target, { browser: false }); }}>备用文件入口 PDF</button>
    {details.openRemoteFile && <button onClick={() => { void details.openRemoteFile?.(target); }}>备用远程入口 PDF</button>}
  </div>;
}

function Workspace({ threadId, children }: { threadId: string; children: ReactNode }) {
  if (params.has('standalone')) return <DetailsWorkspace selected={threadId} active enabled={false}>
    {children}</DetailsWorkspace>;
  if (mode === 'local') return <DetailsWorkspace selected={threadId} active>{children}</DetailsWorkspace>;
  if (!params.has('legacy')) {
    return <ChatDetailsWorkspace selected={threadId} active enabled>{children}</ChatDetailsWorkspace>;
  }
  return <DetailsWorkspace selected={threadId} active
    renderRemoteFile={props => <ChatRemoteFilePreview {...props}
      context={{ client, threadId, ready: true, load }} />}>{children}</DetailsWorkspace>;
}

function Harness() {
  const { mode: appearance } = useThemeMode();
  const [threadId, setThread] = useState('resource-thread');
  const thumbnail = params.get('source') === 'file' ? 'C:/project/preview.png' : 'https://resource.test/thumbnail.png';
  const text = params.has('image') ? `![回复图片](${thumbnail})`
    : names.map(name => `[${name}](C:/project/${name})`).join('\n\n');
  const content = <main style={{ padding: 24, maxWidth: 520 }}><h2>项目资源</h2>
    <p>文件已准备好，点击即可查看。</p>
    {mode === 'local' ? <RichText text={text} /> : <ChatMarkdown text={text} desktop />}
    {params.has('pdfRouting') && <PdfEntries threadId={threadId} />}
    <button onClick={() => setThread('other-thread')}>切换会话</button></main>;
  const algorithm = appearance === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm;
  return <ApplicationTypography><ConfigProvider theme={{
    algorithm: mode === 'web' ? algorithm : [algorithm, theme.compactAlgorithm] }}>
    <BrowserClientContext.Provider value={browser}>
    <FileEnvironmentContext.Provider value={mode === 'remote' && !params.has('standalone') ? environment : null}>
    <FileThreadContext.Provider value={threadId}>
    <ChatFileContext.Provider value={{ client, threadId, ready: true, load }}>
    <ImageThreadContext.Provider value={threadId}>
    <ChatImageContext.Provider value={params.has('source') ? { threadId, ready: true, load: imageLoad } : null}>
      <div style={{ height: '100vh' }}><Workspace threadId={threadId}>{content}</Workspace></div>
    </ChatImageContext.Provider></ImageThreadContext.Provider>
    </ChatFileContext.Provider></FileThreadContext.Provider>
    </FileEnvironmentContext.Provider></BrowserClientContext.Provider>
  </ConfigProvider></ApplicationTypography>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
document.body.style.fontFamily = 'var(--app-font-family, system-ui, sans-serif)';
