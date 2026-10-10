import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ChatMarkdown } from './Markdown';
import { ChatImage } from './ChatImage';
import { ChatActivityLabel } from './ChatActivityLabel';
import { QuoteSourceContext } from './ChatQuotes';
import { UserMessageText } from './UserMessageText';
import { questionMessageText } from '../../../../shared/remote-chat/client/asyncQuestions';
import { messageContent, messageLabel } from '../../../../shared/chat/messageDetails';
import { itemImageSources } from '../../../../shared/chat/imageSources';
import { commandPreview } from '../../../../shared/chat/commandPreview';
import {
  collaborationSummary, isCollaborationActivity,
} from '../../../desktop/src/pages/codexGui/collaborationActivity';
import { formatTurnDuration } from '../../../desktop/src/pages/codexGui/turnTiming';
import type { Item } from './types';
import { palette, useStyles } from './styles';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const PREVIEW_LENGTH = 160;
const STATUS_LABELS: Record<string, string> = {
  get inProgress() { return t("进行中"); }, get completed() { return t("已完成"); }, get failed() { return t("失败"); }, get declined() { return t("已拒绝"); }, get interrupted() { return t("已停止"); },
};
const ACTIVITIES: Record<string, { label: string; icon: IconName }> = {
  fileChange: { get label() { return t("文件修改"); }, icon: 'document-text-outline' },
  mcpToolCall: { get label() { return t("调用工具"); }, icon: 'construct-outline' },
  dynamicToolCall: { get label() { return t("调用工具"); }, icon: 'construct-outline' },
  webSearch: { get label() { return t("搜索网页"); }, icon: 'search-outline' },
  contextCompaction: { get label() { return t("已整理对话上下文"); }, icon: 'list-outline' },
  imageView: { get label() { return t("查看图片"); }, icon: 'image-outline' },
  imageGeneration: { get label() { return t("生成图片"); }, icon: 'sparkles-outline' },
  plan: { get label() { return t("计划"); }, icon: 'list-outline' },
  enteredReviewMode: { get label() { return t("开始代码审查"); }, icon: 'document-text-outline' },
  exitedReviewMode: { get label() { return t("代码审查结果"); }, icon: 'document-text-outline' },
  functionCallOutput: { get label() { return t("工具输出"); }, icon: 'construct-outline' },
  hookPrompt: { get label() { return t("任务补充"); }, icon: 'list-outline' },
};

function commandSummary(item: Item) {
  const action = item.commandActions?.find((entry) => entry.type !== 'unknown');
  const labels: Record<string, string> = { read: t("读取文件"), listFiles: t("浏览文件"), search: t("搜索代码") };
  if (action) return `${labels[action.type] || t("执行命令")} · ${action.name || action.query || action.path || ''}`;
  const status: Record<string, string> = {
    inProgress: t("正在运行"), completed: t("已运行"), failed: t("运行失败"), declined: t("已拒绝"),
  };
  return `${status[item.status ?? ''] || t("执行命令")} ${commandPreview(item.command ?? '')}`;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function activityContent(item: Item) {
  if (item.type === 'fileChange') return item.changes?.map((change) => fileName(change.path)).join('、');
  if (item.type === 'imageView' || item.type === 'imageGeneration') {
    const path = item.savedPath || item.path;
    if (path) return fileName(path);
  }
  return item.query || item.tool || item.review || item.text || item.path;
}

function activitySummary(item: Item): { preview: string; icon: IconName } {
  if (isCollaborationActivity(item)) return { preview: collaborationSummary(item), icon: 'people-outline' };
  if (item.type === 'commandExecution') return { preview: commandSummary(item), icon: 'terminal-outline' };
  if (item.type === 'reasoning') return { icon: 'bulb-outline', preview: [...item.summary ?? [], messageContent(item)]
    .join('\n').slice(0, PREVIEW_LENGTH).trim().split('\n')[0].replace(/[*_`#]/g, '') };
  if (item.type === 'sleep') return { icon: 'time-outline',
    preview: t("等待{value1}", { value1: item.durationMs == null ? '' : ` · ${formatTurnDuration(item.durationMs)}` }) };
  if (item.type === 'webSearch' && item.action?.type === 'openPage') return { icon: 'search-outline',
    preview: t("阅读网页 · {value1}", { value1: item.action.url ?? item.query ?? '' }) };
  const { label, icon } = ACTIVITIES[item.type] ?? { label: t(messageLabel(item)), icon: 'pulse-outline' };
  const content = activityContent(item);
  return { icon, preview: [label, content, STATUS_LABELS[item.status ?? '']].filter(Boolean).join(' · ') };
}

export function ChatActivityRow({ item, onOpen, running = false, count }: {
  item: Item; onOpen: (id: string) => void; running?: boolean; count?: number;
}) {
  const messageStyles = useMessageStyles();
  const color = useThemeColor();
  useLanguage();
  const summary = activitySummary(item);
  if (item.type === 'reasoning' && !summary.preview.trim()) return null;
  const preview = summary.preview.slice(0, PREVIEW_LENGTH).replace(/\s+/g, ' ').trim();
  const label = count ? t("{value1}，查看全部 {value2} 项活动", { value1: preview, value2: count }) : preview;
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    style={messageStyles.activity} onPress={() => onOpen(item.id)}>
    <ChatActivityLabel icon={summary.icon} text={preview} active={running && item.status === 'inProgress'}
      failed={item.status === 'failed'} />
    <Ionicons name="chevron-forward" size={15} color={color(palette.muted, 'muted')} />
  </Pressable>;
}

interface MessageProps {
  item: Item; onOpen: (id: string) => void; running?: boolean; process?: boolean; onQuote?: () => void;
}

export const ChatMessage = memo(function ChatMessage(props: MessageProps) {
  useLanguage();
  return <QuoteSourceContext.Provider value={{ messageId: props.item.id, onQuote: props.onQuote,
    role: props.item.type === 'userMessage' ? 'user' : 'assistant' }}>
    <MessageBody {...props} />
  </QuoteSourceContext.Provider>;
});

function MessageBody({ item, onOpen, running = false, process = false }: MessageProps) {
  const messageStyles = useMessageStyles();
  const styles = useStyles();
  useLanguage();
  const images = itemImageSources(item);
  const text = questionMessageText(item);
  if (item.type === 'userMessage') return <View style={messageStyles.user}>
    <View
      style={[styles.userMessage, messageStyles.bubble, images.length > 0 && messageStyles.imageBubble]}>
      {!!text && <UserMessageText text={text} />}
      {images.map((source, index) => <ChatImage key={index} source={source} />)}
    </View>
  </View>;
  if (item.type !== 'agentMessage') return <ChatActivityRow item={item} onOpen={onOpen} running={running} />;
  return <View style={styles.assistantMessage}>
    <ChatMarkdown text={text} tone={process ? 'process' : 'default'}
      copy={!process && !running && text.trim() ? { text, label: t("复制回复") } : undefined} />
  </View>;
}

const useMessageStyles = createThemedStyles(() => ({
  activity: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 5 },
  user: { alignItems: 'flex-end' },
  bubble: { borderRadius: 16, borderBottomRightRadius: 4, paddingHorizontal: 19, paddingVertical: 15 },
  imageBubble: { width: '92%' },
}));
