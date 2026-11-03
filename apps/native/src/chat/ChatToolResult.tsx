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
import { toolResultPresentation } from '../../../../shared/chat/toolResult';
import { CopyTextButton } from './CopyTextButton';

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
    return <ChatImage source={`data:${part.mimeType};base64,${part.data}`} description={t("client.chat.imageReturnedByTool")} />;
  }
  if (part?.type === 'inputImage' && typeof part.imageUrl === 'string') {
    return <ChatImage source={part.imageUrl} description={t("client.chat.imageReturnedByTool")} />;
  }
  if (part?.type === 'inputAudio' && typeof part.audioUrl === 'string') return <ChatAudio source={part.audioUrl} />;
  if (['resource_link', 'resource'].includes(String(part?.type)) && typeof part?.uri === 'string') {
    return <ChatResourceLink uri={part.uri}
    name={typeof part.name === 'string' ? part.name : undefined} />;
  }
  return <ChatCodeBlock text={serialized(value)} label={t("client.chat.result")} copyLabel={t("client.chat.copyResult")} />;
}

/** Inputs remain optional details; returned structured data is shown in the tool result itself. */
function Payload({ title, value }: { title: string; value: unknown }) {
  const styles = useStyles();
  useLanguage();
  const [open, setOpen] = useState(false);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={t("client.mobile.view.9c1830", { value1: title })} onPress={() => setOpen(true)}>
      <Text style={styles.subtitle}>{title} ›</Text>
    </Pressable>
    <BottomSheet fullWidthContent visible={open} tall title={title} onClose={() => setOpen(false)}>
      <SheetScrollView style={{ flexShrink: 1 }}>
        <ChatCodeBlock text={serialized(value)} label={title} copyLabel={t("client.accounts.copy", { value1: title })} />
      </SheetScrollView>
    </BottomSheet>
  </>;
}

export function ChatToolResult({ item }: { item: Item }) {
  const styles = useStyles();
  useLanguage();
  const { content, structured, hasStructured, rawText } = toolResultPresentation(item);
  const error = toolRecord(item.error)?.message;
  return <View style={{ gap: 12 }}>
    {item.arguments != null && <Payload title={t("client.chat.input")} value={item.arguments} />}
    {item.progress?.map((text, index) => <ChatToolText key={index} text={text} prose />)}
    {hasStructured && <ChatCodeBlock text={JSON.stringify(structured, null, 2) ?? ''} language="json"
      label={t("client.mobile.structuredResult")} showCopy={false} defaultWrap />}
    {content?.map((part, index) => <OutputPart key={index} value={part} />)}
    {!hasStructured && !content && item.result != null && <OutputPart value={item.result} />}
    {!hasStructured && item.output != null && <OutputPart value={item.output} />}
    {item.error != null && <Text style={styles.error}>
      {typeof error === 'string' ? error : t("client.chat.theToolFailedPleaseTryAgain")}</Text>}
    {item.result == null && item.output == null && !content && !item.error && <Text style={styles.subtitle}>
      {item.status === 'inProgress' ? t("client.chat.waitingForToolOutput") : t("client.chat.theToolReturnedNoText")}</Text>}
    {hasStructured && <CopyTextButton text={rawText} label={t("client.chat.copyRawData")} variant="labeled" />}
  </View>;
}
