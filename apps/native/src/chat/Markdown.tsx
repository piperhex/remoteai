import { t, useLanguage } from '../i18n';
import { memo, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View, type TextStyle } from 'react-native';
import { parseDiff } from '../../../../shared/chat/diff';
import { ChatCodeBlock } from './ChatCodeBlock';
import { ChatDiff } from './ChatDiff';
import { ChatCodeReview } from './ChatCodeReview';
import { ChatMath } from './ChatMath';
import { MarkdownParagraph, type MarkdownContext } from './MarkdownInline';
import { renderMathParagraph, type MarkdownNode } from './markdownTree';
import { markdownContent } from './markdownContent';
import { useMarkdownStyles } from './Markdown.styles';
import { useStyles } from './styles';
import { SelectableChatText } from './SelectableChatText';
import type { CopyAction } from './CopyTextButton';

const PAGE_BLOCKS = 60;
const PARAGRAPH_TYPES = new Set(['paragraph_open', 'heading_open', 'inline']);
const LIST_TYPES = new Set(['bullet_list_open', 'ordered_list_open']);

function childContext(context: MarkdownContext, index: number, length: number): MarkdownContext {
  return { ...context, copy: index === length - 1 ? context.copy : undefined };
}

/** Paginate native views, not source text: cutting Markdown midway corrupts tables and code fences. */
function MarkdownPage<Node>({ nodes, render }: {
  nodes: Node[]; render: (node: Node, index: number) => ReactNode;
}) {
  const styles = useStyles();
  useLanguage();
  const [limit, setLimit] = useState(PAGE_BLOCKS);
  return <>{nodes.slice(0, limit).map(render)}
    {nodes.length > limit && <Pressable accessibilityRole="button" style={styles.button}
      onPress={() => setLimit((value) => value + PAGE_BLOCKS)}>
      <Text style={styles.buttonText}>{t("显示更多内容")}</Text>
    </Pressable>}
  </>;
}

function List({ node, context }: { node: MarkdownNode; context: MarkdownContext }) {
  const markdownStyles = useMarkdownStyles();
  const styles = useStyles();
  useLanguage();
  const ordered = node.token.type === 'ordered_list_open';
  const start = Number(node.token.attrGet('start') ?? 1);
  return <View style={markdownStyles.list}>
    <MarkdownPage nodes={node.children} render={(child, index) => <View key={index} style={markdownStyles.listRow}>
      {child.task === undefined
        ? <Text style={[styles.messageText, markdownStyles.marker, context.muted && markdownStyles.muted,
          context.tone === 'process' && markdownStyles.process]}>
          {ordered ? `${start + index}.` : '•'}
        </Text>
        : <View accessibilityRole="checkbox" accessibilityState={{ checked: child.task, disabled: true }}
          accessibilityLabel={child.task ? t("已完成") : t("未完成")}
          style={[markdownStyles.checkbox, child.task && markdownStyles.checked]}>
          {child.task && <Text style={markdownStyles.checkmark}>✓</Text>}
        </View>}
      <View style={markdownStyles.listContent}>
        <Block node={child} context={childContext(context, index, node.children.length)} />
      </View>
    </View>} />
  </View>;
}

function Code({ node, copy }: { node: MarkdownNode; copy?: CopyAction }) {
  useLanguage();
  const language = node.token.info.trim().split(/\s/)[0].toLowerCase();
  const files = useMemo(() => ['diff', 'patch'].includes(language) ? parseDiff(node.token.content) : [],
    [language, node.token.content]);
  if (files.length) return <ChatDiff files={files} copy={copy} />;
  return <ChatCodeBlock text={node.token.content} label={language || t("代码")} language={language} replyCopy={copy} />;
}

function TableRow({ node, context }: { node: MarkdownNode; context: MarkdownContext }) {
  const markdownStyles = useMarkdownStyles();
  useLanguage();
  return <View style={markdownStyles.tableRow}>{node.children.map((child, index) => {
    const alignment = String(child.token.attrGet('style') ?? '').match(/text-align:(left|center|right)/)?.[1];
    return <View key={index} style={markdownStyles.cell}><Block node={child} context={{
      ...childContext(context, index, node.children.length),
      compact: true, header: child.token.type === 'th_open',
      textAlign: alignment as TextStyle['textAlign'] }} /></View>;
  })}</View>;
}

function Block({ node, context = {} }: { node: MarkdownNode; context?: MarkdownContext }) {
  const markdownStyles = useMarkdownStyles();
  useLanguage();
  const { token, children } = node;
  if (token.type.startsWith('math_')) return <ChatMath markup={renderMathParagraph([node])}
    muted={context.muted || context.tone === 'process'} copy={context.copy} />;
  if (token.type === 'fence' || token.type === 'code_block') return <Code node={node} copy={context.copy} />;
  if (PARAGRAPH_TYPES.has(token.type)) {
    const inline = token.type === 'inline' ? children : children.flatMap((child) => child.children);
    return <MarkdownParagraph nodes={inline} heading={token.type === 'heading_open' ? token.tag : undefined}
      context={{ ...context, compact: context.compact || token.hidden }} />;
  }
  if (LIST_TYPES.has(token.type)) return <List node={node} context={context} />;
  if (token.type === 'table_open') return <ScrollView horizontal nestedScrollEnabled style={markdownStyles.table}>
    <View><MarkdownPage nodes={children}
      render={(child, index) => <Block key={index} node={child}
        context={childContext(context, index, children.length)} />} />
    </View>
  </ScrollView>;
  if (token.type === 'tr_open') return <TableRow node={node} context={context} />;
  if (token.type === 'hr') return <><View style={markdownStyles.rule} />
    {context.copy && <SelectableChatText copy={context.copy} />}</>;
  const quote = token.type === 'blockquote_open';
  return <View style={quote ? markdownStyles.quote : undefined}>
    <MarkdownPage nodes={children} render={(child, index) => <Block key={index} node={child}
      context={childContext({ ...context, muted: quote || context.muted }, index, children.length)} />} />
  </View>;
}

export const ChatMarkdown = memo(function ChatMarkdown({ text, tone = 'default', copy, user = false }: {
  text: string; tone?: 'default' | 'process'; copy?: CopyAction; user?: boolean;
}) {
  useLanguage();
  const content = useMemo(() => markdownContent(text, user), [text, user]);
  return <View><MarkdownPage nodes={content} render={(entry, index) => entry.type === 'review'
    ? <ChatCodeReview key={index} comment={entry.comment} copy={index === content.length - 1 ? copy : undefined} />
    : <Block key={index} node={entry.node}
      context={childContext({ tone, copy }, index, content.length)} />} /></View>;
});
