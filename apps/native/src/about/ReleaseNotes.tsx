import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { parseMarkdown, type MarkdownNode } from '../chat/markdownTree';
import { extractReleaseNotes } from './releaseNotesContent';
import { openReleasePage } from './useAppUpdate';
import { useStyles } from './styles';

const PARAGRAPH_TYPES = new Set(['paragraph_open', 'heading_open', 'inline']);
const LIST_TYPES = new Set(['bullet_list_open', 'ordered_list_open']);

const useNoteStyles = createThemedStyles((color) => ({
  blocks: { gap: 8 },
  heading: { fontWeight: '600', color: color('#1f2937', 'ink'), fontSize: 14, lineHeight: 23 },
  bold: { fontWeight: '600' },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  code: { fontFamily: 'monospace', backgroundColor: color('#f3f5f6', 'canvas') },
  link: { color: color('#079c70', 'accent'), textDecorationLine: 'underline' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  marker: { minWidth: 16, textAlign: 'right' },
  item: { flex: 1, minWidth: 0 },
  quote: { borderLeftWidth: 2, borderLeftColor: color('#dce2e6', 'border'), paddingLeft: 10 },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color('#dce2e6', 'border') },
}));

function Inline({ nodes }: { nodes: MarkdownNode[] }) {
  const noteStyles = useNoteStyles();
  const INLINE_STYLES = {
  strong_open: noteStyles.bold, em_open: noteStyles.italic, s_open: noteStyles.strike, code_inline: noteStyles.code,
};
  useLanguage();
  return <>{nodes.map(({ token, children }, index) => {
    if (token.type === 'softbreak') return ' ';
    if (token.type === 'hardbreak') return '\n';
    const href = token.type === 'link_open' ? String(token.attrGet('href') ?? '') : '';
    if (href && /^https?:\/\//i.test(href)) return <Text key={index} accessibilityRole="link"
      style={noteStyles.link} onPress={() => openReleasePage(href)}><Inline nodes={children} /></Text>;
    return <Text key={index} style={INLINE_STYLES[token.type as keyof typeof INLINE_STYLES]}>
      {children.length ? <Inline nodes={children} /> : token.content}</Text>;
  })}</>;
}

function List({ node }: { node: MarkdownNode }) {
  const noteStyles = useNoteStyles();
  const styles = useStyles();
  useLanguage();
  const ordered = node.token.type === 'ordered_list_open';
  const start = Number(node.token.attrGet('start') ?? 1);
  return <View style={noteStyles.blocks}>{node.children.map((child, index) => <View key={index} style={noteStyles.row}>
    <Text style={[styles.detail, noteStyles.marker]}>{ordered ? `${start + index}.` : '•'}</Text>
    <View style={noteStyles.item}><Block node={child} /></View>
  </View>)}</View>;
}

function Block({ node }: { node: MarkdownNode }) {
  const styles = useStyles();
  const noteStyles = useNoteStyles();
  useLanguage();
  const { token, children } = node;
  if (PARAGRAPH_TYPES.has(token.type)) return <Text selectable
    accessibilityRole={token.type === 'heading_open' ? 'header' : undefined}
    style={[styles.detail, token.type === 'heading_open' && noteStyles.heading]}>
    <Inline nodes={children} />
  </Text>;
  if (LIST_TYPES.has(token.type)) return <List node={node} />;
  if (token.type === 'fence' || token.type === 'code_block') {
    return <Text selectable style={[styles.detail, noteStyles.code]}>{token.content.trimEnd()}</Text>;
  }
  if (token.type === 'hr') return <View style={noteStyles.rule} />;
  return <View style={[noteStyles.blocks, token.type === 'blockquote_open' && noteStyles.quote]}>
    {children.map((child, index) => <Block key={index} node={child} />)}
  </View>;
}

export function ReleaseNotes({ text }: { text: string }) {
  const styles = useStyles();
  const noteStyles = useNoteStyles();
  useLanguage();
  const nodes = useMemo(() => parseMarkdown(extractReleaseNotes(text)), [text]);
  if (!nodes.length) return <Text style={styles.detail}>{t("本次版本未提供更新说明。")}</Text>;
  return <View style={noteStyles.blocks}>{nodes.map((node, index) => <Block key={index} node={node} />)}</View>;
}
