import { t, useLanguage } from '../i18n';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DiffFile } from '../../../../shared/chat/diff';
import { generatedImageSource } from '../../../../shared/chat/imageSources';
import { formatTurnDuration, turnElapsedMs } from '../../../desktop/src/pages/codexGui/turnTiming';
import { ChatImage } from './ChatImage';
import { completedTurnFiles } from './turnPresentation';
import type { Turn } from './types';
import { palette, styles } from './styles';
import { useTaskReviewAvailable } from '../../../../shared/remote-chat/TaskReviewContext';
import { ReviewButton } from './review/ReviewButton';
import { ChatRetryButton } from './ChatRetryButton';

export type TurnPanel = 'plan' | 'changes' | 'error' | 'result';
interface Props { turn: Turn; onOpen: (turnId: string, panel: TurnPanel) => void }
const PREVIEW_FILES = 3;

export function turnErrorNotice(turn: Turn) {
  if (turn.status === 'failed' || turn.error) return t("本次回复遇到问题，已中断。");
  if (turn.status === 'completed') return t("本次回复曾出现连接中断，现已恢复。");
  if (turn.status === 'interrupted') return t("本次回复曾出现连接中断。");
  return t("连接暂时中断，Codex 正在重试…");
}

function FileCounts({ added, removed }: { added: number; removed: number }) {
  useLanguage();
  return <View style={summaryStyles.counts} accessibilityLabel={t("新增 {value1} 行，删除 {value2} 行", { value1: added, value2: removed })}>
    <Text style={summaryStyles.added}>+{added}</Text><Text style={summaryStyles.removed}>−{removed}</Text>
  </View>;
}

function FileHeader({ count, added, removed, onOpen, onResult }: {
  count: number; added: number; removed: number; onOpen: () => void; onResult?: () => void;
}) {
  useLanguage();
  return <View style={summaryStyles.fileHeader}>
    <Pressable accessibilityRole="button" accessibilityLabel={t("查看本轮修改：{value1} 个文件", { value1: count })}
      style={summaryStyles.fileOverview} onPress={onOpen}>
      <Ionicons name="document-text-outline" size={21} color={palette.muted} />
      <View style={styles.fill}><Text style={styles.title}>{t("已编辑")}{' '}{count}{' '}{t("个文件")}</Text>
        <FileCounts added={added} removed={removed} /></View>
    </Pressable>
    <View style={summaryStyles.fileActions}>
      {onResult && <ReviewButton label={t('验收结果')} onPress={onResult} />}
      <Pressable accessibilityRole="button" accessibilityLabel={t('审核')}
        style={summaryStyles.review} onPress={onOpen}><Text style={styles.messageText}>{t('审核')}</Text></Pressable>
    </View>
  </View>;
}

function FileSummary({ files, onOpen, onResult, running }: {
  files: DiffFile[]; onOpen: () => void; onResult?: () => void; running: boolean;
}) {
  useLanguage();
  const summary = new Map<string, { path: string; added: number; removed: number }>();
  for (const file of files) {
    const previous = summary.get(file.path);
    summary.set(file.path, { path: file.path, added: (previous?.added ?? 0) + file.added,
      removed: (previous?.removed ?? 0) + file.removed });
  }
  const paths = [...summary.values()];
  const added = paths.reduce((total, file) => total + file.added, 0);
  const removed = paths.reduce((total, file) => total + file.removed, 0);
  if (running) return <Pressable accessibilityRole="button"
    accessibilityLabel={t("查看本轮修改：{value1} 个文件", { value1: paths.length })} style={summaryStyles.pill} onPress={onOpen}>
    <Ionicons name="document-text-outline" size={15} color={palette.muted} />
    <Text style={summaryStyles.pillLabel}>{t("已编辑")}{' '}{paths.length}{' '}{t("个文件")}</Text>
    <FileCounts added={added} removed={removed} />
    <Ionicons name="chevron-forward" size={14} color={palette.muted} />
  </Pressable>;
  return <View style={summaryStyles.files}>
    <FileHeader count={paths.length} added={added} removed={removed} onOpen={onOpen} onResult={onResult} />
    <View style={summaryStyles.fileList}>{paths.slice(0, PREVIEW_FILES).map((file) => <Pressable key={file.path}
      accessibilityRole="button" style={summaryStyles.fileRow} onPress={onOpen}>
      <Text style={[styles.subtitle, styles.fill]} numberOfLines={1} ellipsizeMode="middle">{file.path}</Text>
      <FileCounts added={file.added} removed={file.removed} />
    </Pressable>)}</View>
    {paths.length > PREVIEW_FILES && <Pressable accessibilityRole="button" style={summaryStyles.fileRow}
      onPress={onOpen}><Text style={styles.subtitle}>{t("再显示")}{' '}{paths.length - PREVIEW_FILES}{' '}{t("个文件")}</Text>
      <Ionicons name="chevron-forward" size={15} color={palette.muted} /></Pressable>}
  </View>;
}

export function ChatTurnDuration({ turn }: { turn: Turn }) {
  useLanguage();
  const elapsed = turnElapsedMs(turn, 0);
  return elapsed == null ? null : <Text style={summaryStyles.duration}>{t("用时")}{' '}{formatTurnDuration(elapsed)}</Text>;
}

export function ChatTurnSummary({ turn, onOpen }: Props) {
  useLanguage();
  const reviewAvailable = useTaskReviewAvailable(turn.status);
  const files = useMemo(() => completedTurnFiles(turn), [turn.diff, turn.items]);
  const completed = turn.plan?.filter((step) => step.status === 'completed').length ?? 0;
  const generated = [...new Set(turn.items.filter((item) => item.type === 'imageGeneration'
    && item.status === 'completed' && !item.failure).map(generatedImageSource).filter((src) => !!src))];
  return <View style={summaryStyles.summary}>
    {generated.map((source) => <ChatImage key={source} source={source} description={t("生成的图片")} />)}
    {!!turn.plan?.length && <Pressable accessibilityRole="button" accessibilityLabel={t("查看任务计划")}
      style={summaryStyles.plan} onPress={() => onOpen(turn.id, 'plan')}>
      <Text style={[styles.messageText, styles.fill]}>{t("任务计划")}</Text>
      <Text style={styles.subtitle}>{completed}/{turn.plan.length}</Text>
      <Ionicons name="chevron-forward" size={15} color={palette.muted} />
    </Pressable>}
    {!!files.length && <FileSummary files={files} running={turn.status === 'inProgress'}
      onOpen={() => onOpen(turn.id, 'changes')}
      onResult={reviewAvailable ? () => onOpen(turn.id, 'result') : undefined} />}
    {turn.status === 'interrupted' && <Text style={styles.subtitle}>{t("已停止生成")}</Text>}
    {(turn.error || turn.retryError || turn.status === 'failed') && <View><Pressable accessibilityRole="button"
      accessibilityLabel={t("查看报错详情")} onPress={() => onOpen(turn.id, 'error')}>
      <Text style={summaryStyles.notice}>{turnErrorNotice(turn)}
        {' '}<Text style={summaryStyles.noticeLink}>{t("查看报错详情")}</Text></Text>
    </Pressable><ChatRetryButton turnId={turn.id} /></View>}
  </View>;
}

const summaryStyles = StyleSheet.create({
  summary: { gap: 18, paddingBottom: 6 },
  duration: { color: palette.muted, fontSize: 12, lineHeight: 20, paddingVertical: 8,
    paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: palette.border },
  plan: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1,
    borderColor: palette.border, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14 },
  files: { borderWidth: 1, borderColor: palette.border, borderRadius: 14, overflow: 'hidden' },
  pill: { alignSelf: 'center', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
    gap: 6, borderWidth: 1, borderColor: palette.border, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10 },
  pillLabel: { color: palette.muted, fontSize: 12, lineHeight: 20, flexShrink: 1 },
  fileHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14 },
  fileOverview: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  fileActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  review: { minHeight: 44, justifyContent: 'center' },
  fileList: { borderTopWidth: 1, borderTopColor: palette.border },
  fileRow: { flexDirection: 'row', alignItems: 'baseline', gap: 14, paddingVertical: 10, paddingHorizontal: 16 },
  counts: { flexDirection: 'row', gap: 5 },
  added: { color: '#168348', fontSize: 13, lineHeight: 20 },
  removed: { color: '#c24047', fontSize: 13, lineHeight: 20 },
  notice: { maxWidth: 400, fontSize: 12, lineHeight: 20, color: '#c96c3d' },
  noticeLink: { textDecorationLine: 'underline' },
});
