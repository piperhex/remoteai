import { displayText } from '../i18n/index';
import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { memo } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ChatMarkdown } from './Markdown';
import { ChatImage } from './ChatImage';
import { ChatActivityLabel } from './ChatActivityLabel';
import { QuoteSourceContext } from './ChatQuotes';
import { UserMessageText } from './UserMessageText';
import { CopyTextButton } from './CopyTextButton';
import { messageReferences } from '../../../../shared/chat/messageReferences';
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
  get inProgress() { return t("client.chat.inProgress"); }, get completed() { return t("client.chat.completed"); }, get failed() { return t("client.taskReview.failed"); }, get declined() { return t("client.chat.declined"); }, get interrupted() { return t("client.chat.stopped"); },
};
const ACTIVITIES: Record<string, { label: string; icon: IconName }> = {
  fileChange: { get label() { return t("client.shared.fileChanges"); }, icon: 'document-text-outline' },
  mcpToolCall: { get label() { return t("client.mobile.callingTool"); }, icon: 'construct-outline' },
  dynamicToolCall: { get label() { return t("client.mobile.callingTool"); }, icon: 'construct-outline' },
  webSearch: { get label() { return t("client.shared.searchTheWeb"); }, icon: 'search-outline' },
  contextCompaction: { get label() { return t("client.mobile.conversationContextCompacted"); }, icon: 'list-outline' },
  imageView: { get label() { return t("client.shared.viewImage"); }, icon: 'image-outline' },
  imageGeneration: { get label() { return t("client.shared.generateImage"); }, icon: 'sparkles-outline' },
  plan: { get label() { return t("client.mobile.plan"); }, icon: 'list-outline' },
  enteredReviewMode: { get label() { return t("client.shared.startCodeReview"); }, icon: 'document-text-outline' },
  exitedReviewMode: { get label() { return t("client.shared.codeReviewResults"); }, icon: 'document-text-outline' },
  functionCallOutput: { get label() { return t("client.shared.toolOutput"); }, icon: 'construct-outline' },
  hookPrompt: { get label() { return t("client.shared.taskDetails"); }, icon: 'list-outline' },
};

function commandSummary(item: Item) {
  const action = item.commandActions?.find((entry) => entry.type !== 'unknown');
  const labels: Record<string, string> = { read: t("client.chat.readFile"), listFiles: t("client.chat.browseFiles"), search: t("client.chat.searchCode") };
  if (action) return `${labels[action.type] || t("client.chat.runCommand")} · ${action.name || action.query || action.path || ''}`;
  const status: Record<string, string> = {
    inProgress: t("client.mobile.running"), completed: t("client.mobile.ran"), failed: t("client.mobile.runFailed"), declined: t("client.chat.declined"),
  };
  return `${status[item.status ?? ''] || t("client.chat.runCommand")} ${commandPreview(item.command ?? '')}`;
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
    preview: t("client.mobile.wait", { value1: item.durationMs == null ? '' : ` · ${formatTurnDuration(item.durationMs)}` }) };
  if (item.type === 'webSearch' && item.action?.type === 'openPage') return { icon: 'search-outline',
    preview: t("client.mobile.readWebpage", { value1: item.action.url ?? item.query ?? '' }) };
  const { label, icon } = ACTIVITIES[item.type] ?? { label: displayText(messageLabel(item)), icon: 'pulse-outline' };
  const content = activityContent(item);
  return { icon, preview: [label, content, STATUS_LABELS[item.status ?? '']].filter(Boolean).join(' · ') };
}

export function ChatActivityRow({ item, onOpen, running = false, count, expanded }: {
  item: Item; onOpen: (id: string) => void; running?: boolean; count?: number; expanded?: boolean;
}) {
  const messageStyles = useMessageStyles();
  const color = useThemeColor();
  useLanguage();
  const summary = activitySummary(item);
  if (item.type === 'reasoning' && !summary.preview.trim()) return null;
  const preview = summary.preview.slice(0, PREVIEW_LENGTH).replace(/\s+/g, ' ').trim();
  const label = count ? t("client.mobile.viewAllActivities", { value1: preview, value2: count }) : preview;
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={expanded === undefined ? undefined : { expanded }}
    style={messageStyles.activity} onPress={() => onOpen(item.id)}>
    <ChatActivityLabel icon={summary.icon} text={preview} active={running && item.status === 'inProgress'}
      failed={item.status === 'failed'} />
    <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={15}
      color={color(palette.muted, 'muted')} />
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
      <UserMessageText text={text} references={messageReferences(item)} compact={images.length > 0} />
      {images.length > 0 && <View style={messageStyles.images}>
        {images.map((source, index) => <ChatImage key={index} source={source} sent />)}
      </View>}
    </View>
  </View>;
  if (item.type !== 'agentMessage') return <ChatActivityRow item={item} onOpen={onOpen} running={running} />;
  return <View>
    <ChatMarkdown text={text} tone={process ? 'process' : 'default'} />
    {!process && !running && !!text.trim() && <View style={messageStyles.actions}>
      <CopyTextButton text={text} label={t("client.chat.copyReply")} variant="icon" />
    </View>}
  </View>;
}

const useMessageStyles = createThemedStyles(() => ({
  actions: { alignSelf: 'flex-start', marginLeft: -8 },
  activity: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 36, paddingVertical: 3 },
  user: { alignItems: 'flex-end' },
  bubble: { borderRadius: 16, borderBottomRightRadius: 4, paddingHorizontal: 19, paddingVertical: 15, gap: 10 },
  imageBubble: { gap: 8 },
  images: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, maxWidth: '100%' },
}));
