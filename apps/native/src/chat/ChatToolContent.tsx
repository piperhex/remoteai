import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { Linking, Pressable, Text, View } from 'react-native';
import { SelectableChatText } from './SelectableChatText';
import { UserMessageText } from './UserMessageText';
import { messageContent, messageSections } from '../../../../shared/chat/messageDetails';
import { changedFiles } from '../../../../shared/chat/diff';
import {
  collaborationStates, collaborationStatus, collaborationSummary, isCollaborationActivity,
} from '../../../desktop/src/pages/codexGui/collaborationActivity';
import { formatTurnDuration } from '../../../desktop/src/pages/codexGui/turnTiming';
import { ChatCodeBlock } from './ChatCodeBlock';
import { ChatMarkdown } from './Markdown';
import { ChatDiff } from './ChatDiff';
import { ChatToolResult } from './ChatToolResult';
import { ChatImage } from './ChatImage';
import { generatedImageSource, itemImageSources } from '../../../../shared/chat/imageSources';
import { ChatCommandDetails } from './ChatCommandDetails';
import { toolText } from './toolText';
import { useStyles, palette } from './styles';
import type { Item } from './types';

function WebLink({ url, title }: { url?: string; title?: string }) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  if (!url || !/^https?:\/\//i.test(url)) return <Text style={styles.messageText}>{title || url}</Text>;
  return <Pressable accessibilityRole="link" onPress={() => {
    void Linking.openURL(url).catch(() => undefined);
  }}><SelectableChatText style={[styles.messageText, { color: color(palette.green, 'accent'), textDecorationLine: 'underline' }]}>
    {title || url}</SelectableChatText></Pressable>;
}

function SearchDetails({ item }: { item: Item }) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  return <View style={{ gap: 12 }}>
    {(item.action?.queries ?? [item.action?.query || item.query]).filter(Boolean).map((query, index) =>
      <SelectableChatText key={index} style={styles.messageText}>{query}</SelectableChatText>)}
    {item.action?.url && <WebLink url={item.action.url} />}
    {item.action?.pattern && <Text style={styles.messageText}>{t("查找：")}{item.action.pattern}</Text>}
    {item.results?.map((result, index) => <View key={index}
      style={{ borderTopWidth: 1, borderColor: color(palette.border, 'border'), paddingTop: 8, gap: 4 }}>
      <WebLink url={result.url} title={result.title} />
      {result.snippet && <SelectableChatText style={styles.subtitle}>{result.snippet}</SelectableChatText>}
    </View>)}
  </View>;
}

function CollaborationDetails({ item }: { item: Item }) {
  const styles = useStyles();
  useLanguage();
  return <View style={{ gap: 12 }}>
    <Text style={styles.messageText}>{collaborationSummary(item)}</Text>
    {item.prompt && <ChatMarkdown text={item.prompt} />}
    {item.text && item.text !== item.prompt && <ChatMarkdown text={item.text} />}
    {collaborationStates(item).map((state, index) => <View key={index}>
      <Text style={styles.subtitle}>{t("协作任务")}{' '}{index + 1} · {collaborationStatus(state.status)}</Text>
      {state.message && <ChatMarkdown text={state.message} />}
    </View>)}
  </View>;
}

function UserMessageDetails({ item }: { item: Item }) {
  useLanguage();
  const text = messageContent(item);
  return <View style={{ gap: 12 }}>
    {!!text && <UserMessageText text={text} copy />}
    {itemImageSources(item).map((source, index) => <ChatImage key={index} source={source} />)}
  </View>;
}

export function ChatToolContent({ item }: { item: Item }) {
  const styles = useStyles();
  useLanguage();
  const text = toolText(item);
  if (item.type === 'userMessage') return <UserMessageDetails item={item} />;
  if (['agentMessage', 'reasoning', 'plan', 'enteredReviewMode', 'exitedReviewMode'].includes(item.type)) {
    return <ChatMarkdown text={text} />;
  }
  if (item.type === 'commandExecution') return <ChatCommandDetails item={item} />;
  if (item.type === 'fileChange') return <ChatDiff files={changedFiles(item.changes ?? [])} />;
  if (['mcpToolCall', 'dynamicToolCall', 'functionCallOutput'].includes(item.type)) {
    return <ChatToolResult item={item} />;
  }
  if (item.type === 'webSearch') return <SearchDetails item={item} />;
  if (item.type === 'imageView' || item.type === 'imageGeneration') return <View style={{ gap: 12 }}>
    {item.type === 'imageView' && <ChatImage source={generatedImageSource(item)} description={t("查看的图片")} />}
    {(item.path || item.savedPath) && <SelectableChatText style={styles.subtitle}>
      {item.path || item.savedPath}</SelectableChatText>}
    {item.failure?.message && <Text style={styles.error}>{item.failure.message}</Text>}
    {item.revisedPrompt && <ChatMarkdown text={item.revisedPrompt} />}
  </View>;
  if (isCollaborationActivity(item)) return <CollaborationDetails item={item} />;
  if (item.type === 'contextCompaction') return <Text style={styles.messageText}>
    {t("较早的对话已整理为摘要，可以继续处理当前任务。")}</Text>;
  if (item.type === 'sleep') return <Text style={styles.messageText}>
    {t("等待时长：")}{formatTurnDuration(item.durationMs ?? 0)}</Text>;
  return <>{messageSections(item).map((section, index) =>
    <ChatCodeBlock key={index} text={section.text} label={t(section.title)} copyLabel={t("复制{value1}", { value1: t(section.title) })} />)}</>;
}
