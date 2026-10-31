import { t, useLanguage } from '../i18n';
import { Children, isValidElement, useContext, useEffect, useRef, type ReactNode } from 'react';
import { FileEnvironmentContext } from '../../../desktop/src/pages/codexGui/fileEnvironment';
import { RichText } from '../../../desktop/src/pages/codexGui/RichText';
import { previewReference } from '../../../desktop/src/pages/codexGui/filePreview/references';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { mathOptions, normalizeMathDelimiters } from '../../../../shared/chat/mathMarkdown';
import { installTouchTextSelection } from '../../../../shared/chat/touchTextSelection';
import 'katex/dist/katex.min.css';
import './math.css';
import { parseFileReference } from '../../../../shared/chat/fileReference';
import { isInlineImage, localImageSource } from '../../../../shared/chat/imageSources';
import { ChatCodeBlock } from './ChatCodeBlock';
import { ChatImage } from './ChatImage';
import { ChatFileContext, ChatFileLink } from './ChatFileLink';
import { ChatMarkdownTable } from './ChatMarkdownTable';
import { MermaidDiagram } from '../../../../shared/chat/MermaidDiagram';

function textContent(children: ReactNode): string {
  return Children.toArray(children).map(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    return isValidElement<{ children?: ReactNode }>(child) ? textContent(child.props.children) : '';
  }).join('');
}

function codeBlock(children: ReactNode, desktop = false) {
  const code = Children.toArray(children).find(child => isValidElement(child));
  const language = isValidElement<{ className?: string }>(code)
    ? code.props.className?.replace(/^language-/, '') ?? '' : '';
  const text = textContent(children).replace(/\n$/, '');
  if (language.toLowerCase() === 'mermaid') {
    return <MermaidDiagram source={text} previewLabel={t("client.chat.preview")} sourceLabel={t("client.chat.source")}
      copyLabel={t("client.chat.copySource")} />;
  }
  return <ChatCodeBlock text={text} language={language} desktop={desktop} />;
}

function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const files = useContext(ChatFileContext);
  const source = src && files?.basePath ? previewReference(src, files.basePath)?.path ?? src : src;
  return <ChatImage source={source} description={alt || t("client.chat.image")} />;
}

const components: Components = {
  a: ({ children, href }) => <ChatFileLink href={href}>{children}</ChatFileLink>,
  img: ({ src, alt }) => <MarkdownImage src={src} alt={alt} />,
  pre: ({ children }) => codeBlock(children),
};

const desktopComponents: Components = { ...components,
  pre: ({ children }) => codeBlock(children, true),
  table: ({ children }) => <ChatMarkdownTable>{children}</ChatMarkdownTable> };

export function ChatMarkdown({ text, process = false, desktop = false }: {
  text: string; process?: boolean; desktop?: boolean;
}) {
  useLanguage();
  const environment = useContext(FileEnvironmentContext);
  const files = useContext(ChatFileContext);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => root.current ? installTouchTextSelection(root.current) : undefined, []);
  if (environment && !files?.basePath) {
    return <div className={process ? 'chat-process-prose' : undefined}><RichText text={text} /></div>;
  }
  return <div ref={root} className={`chat-markdown${process ? ' chat-process-prose' : ''}`}>
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]} rehypePlugins={[[rehypeKatex, mathOptions]]}
      components={desktop || environment ? desktopComponents : components}
      urlTransform={(url, key) => {
        if (/^https?:\/\//i.test(url)) return url;
        if (key === 'href' && parseFileReference(url)) return url;
        return key === 'src' && (isInlineImage(url) || localImageSource(url)) ? url : '';
      }}>{normalizeMathDelimiters(text)}</ReactMarkdown>
  </div>;
}
