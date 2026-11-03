import { useEffect, useMemo, useState } from 'react';
import { fileResourceKey, fileResourceUrl, type BrowserResource }
  from '../../../desktop/src/pages/codexGui/filePreview/browserResources';
import { FilePreviewPanel } from '../../../desktop/src/pages/codexGui/filePreview/FilePreviewPanel';
import type { FilePreviewData } from '../../../../shared/remote-chat/files';
import { filePreviewKind } from '../../../../shared/file-preview/kinds';
import { ChatFilePreviewContent, type FilePreviewContext } from './ChatFilePreview';
import { ChatFileContext } from './ChatFileLink';
import { loadVideoPreview } from './videoPreview';
import { t } from '../i18n';
import { isDownloadOnlyFile } from '../../../../shared/remote-chat/filePreview';
import { ResourceDownloadCard } from '../../../../shared/file-preview/ResourceDownloadCard';
import { FileDownloadButton } from '../downloads/FileDownloadButton';

function BinaryResource({ path, context, active }: { path: string; context: FilePreviewContext; active: boolean }) {
  const [data, setData] = useState<FilePreviewData>();
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let dispose: (() => Promise<void>) | undefined;
    if (!context.threadId || !context.ready) { setFailed(true); return; }
    void loadVideoPreview({ client: context.client, threadId: context.threadId, path, signal: controller.signal,
      progress: (received, total) => { if (!controller.signal.aborted) setProgress(total ? received / total * 100 : 0); },
    }).then(async result => {
      dispose = result.dispose;
      if (controller.signal.aborted) { await dispose(); return; }
      setData({ sessionId: '', path, name: path.split(/[\\/]/).at(-1) ?? path,
        kind: filePreviewKind(path) ?? 'text', url: result.url, text: null });
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); void dispose?.(); };
  }, [context.client, context.threadId, context.ready, path]);
  if (failed) return <p role="status" className="chat-file-preview-note">{t('client.filePreview.unavailable')}</p>;
  if (!data) return <p role="status" className="chat-file-preview-note">
    {t('client.chat.loadingFile')} {Math.round(progress)}%</p>;
  return <FilePreviewPanel data={data} active={active} embedded
    fileActions={<FileDownloadButton path={path} context={context} />} />;
}

function ChatResourceContent({ path, line, context, active }: {
  path: string; line?: number; context: FilePreviewContext; active: boolean;
}) {
  const nestedContext = useMemo(() => ({ ...context, basePath: path }), [context, path]);
  const kind = filePreviewKind(path);
  const binary = kind && kind !== 'html' && kind !== 'markdown';
  if (isDownloadOnlyFile(path, { mediaPreview: true })) return <ResourceDownloadCard path={path}>
    <FileDownloadButton path={path} context={context} />
  </ResourceDownloadCard>;
  return <ChatFileContext.Provider value={nestedContext}>
    {binary ? <BinaryResource path={path} context={context} active={active} />
      : <ChatFilePreviewContent path={path} line={line} context={context} />}
  </ChatFileContext.Provider>;
}

export function chatBrowserResource(path: string, context: FilePreviewContext, line?: number): BrowserResource {
  return { key: fileResourceKey({ path, threadId: context.threadId, line }),
    title: path.split(/[\\/]/).at(-1) ?? path, url: fileResourceUrl(path),
    render: props => <ChatResourceContent path={path} line={line} context={context} active={props.active} /> };
}
