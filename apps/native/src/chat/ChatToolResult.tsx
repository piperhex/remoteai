import { t, useLanguage } from '../i18n';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { SheetScrollView } from '../components/SheetScrollView';
import { ChatCodeBlock } from './ChatCodeBlock';
import { ChatToolText } from './ChatToolText';
import { ChatImage } from './ChatImage';
import { ChatResourceLink } from './ChatResourceLink';
import { ChatAudio } from './ChatAudio';
import { toolOutputText } from './toolOutput';
import { useStyles } from './styles';
import type { Item } from './types';

export function toolRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function serialized(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';
}

function OutputPart({ value }: { value: unknown }) {
  useLanguage();
  const part = toolRecord(value);
  const text = toolOutputText(value);
  if (text) return <ChatToolText {...text} />;
  if (part?.type === 'image' && typeof part.data === 'string' && typeof part.mimeType === 'string') {
    return <ChatImage source={`data:${part.mimeType};base64,${part.data}`} description={t("工具返回的图片")} />;
  }
  if (part?.type === 'inputImage' && typeof part.imageUrl === 'string') {
    return <ChatImage source={part.imageUrl} description={t("工具返回的图片")} />;
  }
  if (part?.type === 'inputAudio' && typeof part.audioUrl === 'string') return <ChatAudio source={part.audioUrl} />;
  if (['resource_link', 'resource'].includes(String(part?.type)) && typeof part?.uri === 'string') {
    return <ChatResourceLink uri={part.uri}
    name={typeof part.name === 'string' ? part.name : undefined} />;
  }
  return <ChatCodeBlock text={serialized(value)} label={t("结果")} copyLabel={t("复制结果")} />;
}

/** Inputs and structured payloads use a drawer, like other expandable mobile content. */
function Payload({ title, value }: { title: string; value: unknown }) {
  const styles = useStyles();
  useLanguage();
  const [open, setOpen] = useState(false);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={t("查看{value1}", { value1: title })} onPress={() => setOpen(true)}>
      <Text style={styles.subtitle}>{title} ›</Text>
    </Pressable>
    <BottomSheet fullWidthContent visible={open} tall title={title} onClose={() => setOpen(false)} dragFromHeaderOnly>
      <SheetScrollView style={{ flexShrink: 1 }}>
        <ChatCodeBlock text={serialized(value)} label={title} copyLabel={t("复制{value1}", { value1: title })} />
      </SheetScrollView>
    </BottomSheet>
  </>;
}

export function ChatToolResult({ item }: { item: Item }) {
  const styles = useStyles();
  useLanguage();
  const result = toolRecord(item.result);
  const content = item.contentItems ?? (Array.isArray(result?.content) ? result.content : undefined);
  const error = toolRecord(item.error)?.message;
  return <View style={{ gap: 12 }}>
    {item.arguments != null && <Payload title={t("输入")} value={item.arguments} />}
    {item.progress?.map((text, index) => <ChatToolText key={index} text={text} prose />)}
    {content?.map((part, index) => <OutputPart key={index} value={part} />)}
    {result?.structuredContent != null && <Payload title={t("结构化结果")} value={result.structuredContent} />}
    {!content && item.result != null && <OutputPart value={item.result} />}
    {item.output != null && <OutputPart value={item.output} />}
    {item.error != null && <Text style={styles.error}>
      {typeof error === 'string' ? error : t("工具执行失败，请重试。")}</Text>}
    {item.result == null && item.output == null && !content && !item.error && <Text style={styles.subtitle}>
      {item.status === 'inProgress' ? t("正在等待工具返回…") : t("工具没有返回文本内容。")}</Text>}
  </View>;
}
