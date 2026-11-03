import { createContext, useContext, useState, type ReactNode } from 'react';
import { ChatFilePreview, type FilePreviewContext } from './ChatFilePreview';
import { parseFileReference } from '../../../../shared/chat/fileReference';
import { DetailsContext } from '../../../desktop/src/pages/codexGui/detailsContext';
import { previewReference } from '../../../desktop/src/pages/codexGui/filePreview/references';
import { isDownloadOnlyFile } from './ChatDownloadFile';
import { FileEnvironmentContext } from '../../../desktop/src/pages/codexGui/fileEnvironment';
import { MessageLink } from '../../../desktop/src/pages/codexGui/MessageLink';
import { FileMenu } from '../../../desktop/src/pages/codexGui/FileMenu';
import { chatBrowserResource } from './chatBrowserResource';

export const ChatFileContext = createContext<FilePreviewContext | null>(null);

function FilePreviewLink({ path, line, children }: { path: string; line?: number; children: ReactNode }) {
  const context = useContext(ChatFileContext)!;
  const panel = useContext(DetailsContext);
  const [preview, setPreview] = useState(false);
  const open = () => {
    if (panel?.openResource) {
      panel.openResource(chatBrowserResource(path, context, line));
    } else if (panel?.openRemoteFile && !isDownloadOnlyFile(path)) {
      void panel.openRemoteFile({ path, line, threadId: context.threadId });
    } else setPreview(true);
  };
  return <span className="chat-file-link">
    <button type="button" className="chat-text-action" disabled={!context.ready || !context.threadId}
      onClick={open}>{children}</button>
    {preview && <ChatFilePreview path={path} line={line} context={context} onClose={() => setPreview(false)} />}
  </span>;
}

export function ChatFileLink({ href, children }: { href?: string; children?: ReactNode }) {
  const context = useContext(ChatFileContext);
  const panel = useContext(DetailsContext);
  const environment = useContext(FileEnvironmentContext);
  const file = context?.basePath ? previewReference(href ?? '', context.basePath) : parseFileReference(href ?? '');
  if (environment) return file ? <FileMenu {...file} preview>{children}</FileMenu>
    : <MessageLink href={href}>{children}</MessageLink>;
  if (file && context) return <FilePreviewLink key={`${context.threadId}:${file.path}`}
    path={file.path} line={file.line}>
    {children}</FilePreviewLink>;
  if (!href || !/^https?:\/\//i.test(href)) return <span>{children}</span>;
  if (panel) return <MessageLink href={href}>{children}</MessageLink>;
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}
