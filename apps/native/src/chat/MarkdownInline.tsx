import { t, useLanguage } from '../i18n';
import { useContext } from 'react';
import { Linking, Text, View, type TextStyle } from 'react-native';
import { parseFileReference } from '../../../../shared/chat/fileReference';
import { ChatFileContext } from './ChatFilePreview';
import { ChatImage } from './ChatImage';
import { ChatMath } from './ChatMath';
import { hasMarkdownImage, hasMarkdownMath, renderMathParagraph, type MarkdownNode } from './markdownTree';
import { headingStyles, useMarkdownStyles } from './Markdown.styles';
import { useStyles } from './styles';
import { SelectableChatText } from './SelectableChatText';
import type { CopyAction } from './CopyTextButton';

export interface MarkdownContext {
  muted?: boolean; compact?: boolean; header?: boolean; textAlign?: TextStyle['textAlign'];
  tone?: 'default' | 'process';
  copy?: CopyAction;
}

function openLink(url: string) {
  if (/^https?:\/\//i.test(url)) void Linking.openURL(url).catch(() => undefined);
}

function inlineRuns(nodes: MarkdownNode[]): (MarkdownNode | string)[] {
  const runs: (MarkdownNode | string)[] = [];
  let plain = '';
  for (const node of nodes) {
    const type = node.token.type;
    if (type === 'text' || type === 'softbreak' || type === 'hardbreak') {
      plain += type === 'text' ? node.token.content : '\n';
      continue;
    }
    if (plain) runs.push(plain);
    plain = '';
    runs.push(node);
  }
  if (plain) runs.push(plain);
  return runs;
}

function Inline({ nodes, muted = false }: {
  nodes: MarkdownNode[]; muted?: boolean;
}) {
  const markdownStyles = useMarkdownStyles();
  useLanguage();
  const styles = useStyles();
  const INLINE_STYLES = { strong_open: markdownStyles.bold, em_open: markdownStyles.italic,
  s_open: markdownStyles.strike, code_inline: [styles.code, markdownStyles.inlineCode] };
  const openFile = useContext(ChatFileContext);
  // Plain runs inherit their enclosing Text style without consuming a native span for every line.
  return <>{inlineRuns(nodes).map((run, index) => {
    if (typeof run === 'string') return run;
    const { token, children } = run;
    const style = INLINE_STYLES[token.type as keyof typeof INLINE_STYLES];
    if (token.type === 'link_open') return <Text key={index} accessibilityRole="link" style={markdownStyles.link}
      onPress={() => {
        const url = String(token.attrGet('href') ?? '');
        const file = parseFileReference(url);
        if (file && openFile) openFile(file);
        else openLink(url);
      }}><Inline nodes={children} muted={muted} /></Text>;
    return <Text key={index} style={[style, token.type === 'code_inline' && muted && markdownStyles.muted]}>
      {children.length ? <Inline nodes={children} muted={muted} />
        : token.content}</Text>;
  })}</>;
}

function paragraphParts(nodes: MarkdownNode[]): MarkdownNode[][] {
  const parts: MarkdownNode[][] = [];
  for (const node of nodes) {
    if (hasMarkdownImage(node)) parts.push([node], []);
    else (parts[parts.length - 1] ?? (parts[0] = [])).push(node);
  }
  return parts;
}

export function MarkdownParagraph({ nodes, heading, context = {} }: {
  nodes: MarkdownNode[]; heading?: string; context?: MarkdownContext;
}) {
  const styles = useStyles();
  const markdownStyles = useMarkdownStyles();
  useLanguage();
  const parts = paragraphParts(nodes).filter((part) => part.length);
  return <View>{parts.map((part, index) => {
    if (!part.length) return null;
    const first = part[0];
    const copy = index === parts.length - 1 ? context.copy : undefined;
    if (first.token.type === 'image') return <View key={index}><ChatImage
      source={String(first.token.attrGet('src') ?? '')} description={first.token.content || t("图片")} />
      {copy && <SelectableChatText copy={copy} />}</View>;
    if (hasMarkdownImage(first)) return <MarkdownParagraph key={index}
      nodes={first.children} heading={heading} context={{ ...context, copy }} />;
    if (part.some(hasMarkdownMath)) return <ChatMath key={index} markup={renderMathParagraph(part)}
      muted={context.muted || context.tone === 'process'}
      fontSize={heading ? headingStyles[heading]?.fontSize : undefined} copy={copy} compact={context.compact} />;
    return <SelectableChatText key={index} copy={copy} accessibilityRole={heading ? 'header' : undefined}
      style={[styles.messageText, markdownStyles.paragraph, context.compact && markdownStyles.compact,
        context.tone === 'process' && markdownStyles.process,
        context.muted && markdownStyles.muted, (heading || context.header) && markdownStyles.bold,
        heading ? headingStyles[heading] : undefined, { textAlign: context.textAlign }]}>
      <Inline nodes={part} muted={context.muted || context.tone === 'process'} />
    </SelectableChatText>;
  })}</View>;
}
