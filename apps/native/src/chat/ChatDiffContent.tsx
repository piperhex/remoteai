import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { useContext, useMemo, useState } from 'react';
import { SelectableChatText } from './SelectableChatText';
import { Pressable, ScrollView, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { pairDiffLines, type DiffFile, type DiffLine, type DiffPair } from '../../../../shared/chat/diff';
import { INLINE_COPY_WIDTH, type CopyAction } from './CopyTextButton';
import { ChatFileContext } from './ChatFilePreview';
import { HighlightedCode, fileLanguage } from './ChatCodeHighlight';
import { palette, useStyles } from './styles';

const PAGE_LINES = 200;
const NUMBER_COLUMN_WIDTH = 34;
const MIN_SCROLL_COLUMN_WIDTH = 320;
const CELL_BORDER_WIDTH = 1;
const REDUNDANT_HEADER = /^(diff --git |index |--- |\+\+\+ |new file mode |deleted file mode )/;

function UnifiedRow({ line, language, wrap, copy, onComment }: {
  line: DiffLine; language: string; wrap: boolean; copy?: CopyAction; onComment?: (line: DiffLine) => void;
}) {
  const diffStyles = useDiffStyles();
  const styles = useStyles();
  useLanguage();
  const marker = line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' ';
  const heading = line.kind === 'hunk' || line.kind === 'meta';
  return <View style={[diffStyles.line, diffStyles[line.kind]]}>
    {onComment && !!(line.oldLine || line.newLine) && <Pressable accessibilityRole="button"
      accessibilityLabel={t('对第 {value1} 行留言', { value1: line.newLine ?? line.oldLine ?? 0 })}
      style={diffStyles.comment} onPress={() => onComment(line)}>
      <Text style={diffStyles.actionText}>{t('留言')}</Text></Pressable>}
    <Text style={[styles.code, diffStyles.number]}>{line.oldLine ?? ''}</Text>
    <Text style={[styles.code, diffStyles.number]}>{line.newLine ?? ''}</Text>
    <Text style={[styles.code, diffStyles.sign]}>{marker}</Text>
    <SelectableChatText copy={copy} style={[styles.code, wrap ? diffStyles.wrappedText : diffStyles.unwrappedText]}>
      <HighlightedCode text={line.text || ' '} language={heading ? '' : language} /></SelectableChatText>
  </View>;
}

function SplitCell({ line, side, language, column, wrap, copy }: {
  line?: DiffLine; side: 'left' | 'right'; language: string; column: StyleProp<ViewStyle>; wrap: boolean;
  copy?: CopyAction;
}) {
  const diffStyles = useDiffStyles();
  const styles = useStyles();
  useLanguage();
  return <View style={[diffStyles.cell, column, line && diffStyles[line.kind]]}>
    <Text style={[styles.code, diffStyles.number]}>{side === 'left' ? line?.oldLine : line?.newLine}</Text>
    <SelectableChatText copy={copy} style={[styles.code, wrap ? diffStyles.wrappedText : diffStyles.unwrappedText]}>
      <HighlightedCode text={line?.text || ' '} language={language} /></SelectableChatText>
  </View>;
}

/** Measure with the native font in an unconstrained scroller; character counts miss CJK, tabs and font scaling. */
function MeasureCode({ text, onMeasure }: { text: string; onMeasure: (width: number) => void }) {
  const diffStyles = useDiffStyles();
  const styles = useStyles();
  useLanguage();
  return <ScrollView horizontal scrollEnabled={false} style={diffStyles.measure} pointerEvents="none"
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    onContentSizeChange={(width) => onMeasure(Math.ceil(width))}>
    <Text style={styles.code}>{text}</Text>
  </ScrollView>;
}

function SplitRows({ pairs, language, wrap, copy }: {
  pairs: DiffPair[]; language: string; wrap: boolean; copy: CopyAction;
}) {
  const diffStyles = useDiffStyles();
  const styles = useStyles();
  useLanguage();
  const [widths, setWidths] = useState({ left: 0, right: 0 });
  const text = useMemo(() => ({ left: pairs.map((pair) => pair.left?.text || ' ').join('\n'),
    right: pairs.map((pair) => pair.right?.text || ' ').join('\n') }), [pairs]);
  const left = Math.max(MIN_SCROLL_COLUMN_WIDTH,
    widths.left + NUMBER_COLUMN_WIDTH + CELL_BORDER_WIDTH + INLINE_COPY_WIDTH);
  const right = Math.max(MIN_SCROLL_COLUMN_WIDTH,
    widths.right + NUMBER_COLUMN_WIDTH + CELL_BORDER_WIDTH + INLINE_COPY_WIDTH);
  const columns = wrap ? [diffStyles.wrappedCell, diffStyles.wrappedCell] : [{ width: left }, { width: right }];
  return <View style={wrap ? undefined : { width: left + right }}>
    {!wrap && <>
      <MeasureCode text={text.left} onMeasure={(width) => setWidths((current) =>
        width > current.left ? { ...current, left: width } : current)} />
      <MeasureCode text={text.right} onMeasure={(width) => setWidths((current) =>
        width > current.right ? { ...current, right: width } : current)} />
    </>}
    <View style={diffStyles.line}>
      <Text style={[diffStyles.columnLabel, columns[0]]}>{t("修改前")}</Text>
      <Text style={[diffStyles.columnLabel, columns[1]]}>{t("修改后")}</Text>
    </View>
    {pairs.map((pair, index) => pair.heading
      ? <SelectableChatText key={index} style={[styles.code, diffStyles.hunk]}
        copy={index === pairs.length - 1 ? copy : undefined}>
        {pair.heading.text}</SelectableChatText>
      : <View key={index} style={diffStyles.line}>
        <SplitCell line={pair.left} side="left" language={language} column={columns[0]} wrap={wrap}
          copy={index === pairs.length - 1 && !pair.right ? copy : undefined} />
        <SplitCell line={pair.right} side="right" language={language} column={columns[1]} wrap={wrap}
          copy={index === pairs.length - 1 && pair.right ? copy : undefined} />
      </View>)}
  </View>;
}

export function ChatDiffContent({ file, onComment }: { file: DiffFile; onComment?: (line: DiffLine) => void }) {
  const styles = useStyles();
  const diffStyles = useDiffStyles();
  useLanguage();
  const [limit, setLimit] = useState(PAGE_LINES);
  const [wrap, setWrap] = useState(false);
  const [split, setSplit] = useState(false);
  const openFile = useContext(ChatFileContext);
  const lines = useMemo(() => file.lines.filter((line) => line.kind !== 'meta'
    || !REDUNDANT_HEADER.test(line.text)), [file.lines]);
  const pairs = useMemo(() => split ? pairDiffLines(lines) : [], [lines, split]);
  const language = fileLanguage(file.path);
  const total = split ? pairs.length : lines.length;
  const copy = { text: file.raw, label: t("复制 diff") };
  const rows = split ? <SplitRows pairs={pairs.slice(0, limit)} language={language} wrap={wrap} copy={copy} />
    : <View>{lines.slice(0, limit).map((line, index) =>
      <UnifiedRow key={index} line={line} language={language} wrap={wrap} onComment={onComment}
        copy={index === Math.min(lines.length, limit) - 1 ? copy : undefined} />)}</View>;
  return <View style={{ gap: 10 }}>
    {file.previousPath && <SelectableChatText style={styles.subtitle}>
      {file.previousPath} → {file.path}</SelectableChatText>}
    <View style={diffStyles.toolbar}>
      <Pressable accessibilityRole="button" style={diffStyles.action} onPress={() => setWrap(!wrap)}>
        <Text style={diffStyles.actionText}>{wrap ? t("横向滚动") : t("自动换行")}</Text></Pressable>
      {!onComment && <Pressable accessibilityRole="button" style={diffStyles.action} onPress={() => setSplit(!split)}>
        <Text style={diffStyles.actionText}>{split ? t("统一") : t("并排")}</Text></Pressable>}
      {openFile && file.kind !== 'delete' && <Pressable accessibilityRole="button" style={diffStyles.action}
        onPress={() => openFile({ path: file.path })}><Text style={diffStyles.actionText}>{t("查看文件")}</Text></Pressable>}
    </View>
    {wrap ? rows : <ScrollView horizontal nestedScrollEnabled>{rows}</ScrollView>}
    {!total && <SelectableChatText style={styles.subtitle} copy={copy}>
      {file.kind === 'add' ? t("新增空文件") : t("此文件没有可显示的文本差异。")}</SelectableChatText>}
    {total > limit && <Pressable accessibilityRole="button" style={styles.button}
      onPress={() => setLimit(limit + PAGE_LINES)}>
      <Text style={styles.buttonText}>{t("继续显示（还有")}{' '}{total - limit}{' '}{t("行）")}</Text></Pressable>}
  </View>;
}

const useDiffStyles = createThemedStyles((color) => ({
  comment: { width: 44, minHeight: 32, justifyContent: 'center', alignItems: 'center' },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: { minHeight: 36, paddingHorizontal: 6, justifyContent: 'center' },
  actionText: { color: color(palette.muted, 'muted'), fontSize: 12, lineHeight: 20 },
  line: { flexDirection: 'row', minHeight: 23 },
  number: { width: NUMBER_COLUMN_WIDTH, flexShrink: 0, color: color(palette.muted, 'muted'), textAlign: 'right', paddingRight: 6,
    borderRightWidth: 1, borderColor: color(palette.border, 'border') },
  sign: { width: 20, flexShrink: 0, textAlign: 'center' },
  cell: { flexDirection: 'row', borderRightWidth: CELL_BORDER_WIDTH, borderColor: color(palette.border, 'border') },
  wrappedCell: { flex: 1, minWidth: 0 },
  wrappedText: { flex: 1, minWidth: 0 },
  unwrappedText: { flexShrink: 0 },
  measure: { position: 'absolute', left: 0, top: 0, width: 1, height: 1, opacity: 0 },
  columnLabel: { padding: 8, color: color(palette.muted, 'muted'), backgroundColor: color('#f4f6f5', 'canvas') },
  add: { backgroundColor: color('#e0f2e7', 'elevated') }, remove: { backgroundColor: color('#fbe5e5', 'canvas') },
  hunk: { backgroundColor: color('#f4f6f5', 'canvas'), paddingVertical: 2 }, meta: { backgroundColor: color('#f4f6f5', 'canvas') }, context: {},
}));
