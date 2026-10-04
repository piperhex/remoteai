import { t, useLanguage } from '../i18n';
import { Children, isValidElement, useEffect, useRef, type ReactNode } from 'react';
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
import { ChatFileLink } from './ChatFileLink';
import { ChatMarkdownTable } from './ChatMarkdownTable';

function textContent(children: ReactNode): string {
  return Children.toArray(children).map(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    return isValidElement<{ children?: ReactNode }>(child) ? textContent(child.props.children) : '';
  }).join('');
}

function codeBlock(children: ReactNode, desktop = false) {
  const code = Children.toArray(children).find(child => isValidElement(child));
  const language = isValidElement<{ className?: string }>(code)
    ? code.props.className?.replace(/^language-/, '') : '';
  return <ChatCodeBlock text={textContent(children).replace(/\n$/, '')} language={language} desktop={desktop} />;
}

const components: Components = {
  a: ({ children, href }) => <ChatFileLink href={href}>{children}</ChatFileLink>,
  img: ({ src, alt }) => <ChatImage source={src} description={alt || t("图片")} />,
  pre: ({ children }) => codeBlock(children),
};

const desktopComponents: Components = { ...components,
  pre: ({ children }) => codeBlock(children, true),
  table: ({ children }) => <ChatMarkdownTable>{children}</ChatMarkdownTable> };

export function ChatMarkdown({ text, process = false, desktop = false }: {
  text: string; process?: boolean; desktop?: boolean;
}) {
  useLanguage();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => root.current ? installTouchTextSelection(root.current) : undefined, []);
  return <div ref={root} className={`chat-markdown${process ? ' chat-process-prose' : ''}`}>
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]} rehypePlugins={[[rehypeKatex, mathOptions]]}
      components={desktop ? desktopComponents : components}
      urlTransform={(url, key) => {
        if (/^https?:\/\//i.test(url)) return url;
        if (key === 'href' && parseFileReference(url)) return url;
        return key === 'src' && (isInlineImage(url) || localImageSource(url)) ? url : '';
      }}>{normalizeMathDelimiters(text)}</ReactMarkdown>
  </div>;
}
