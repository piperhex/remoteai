import { t, useLanguage } from '../i18n';
import { DeferredDetails } from '../../../../shared/chat/DeferredDetails';
import type { Item } from './types';
import { toolOutputText, toolOutputPage } from '../../../../shared/chat/toolOutput';
import { useState } from 'react';
import { ChatCodeBlock } from './ChatCodeBlock';
import { ChatMarkdown } from './ChatMarkdown';
import { ChatImage } from './ChatImage';
import { ChatFileLink } from './ChatFileLink';
import { ChatCopyButton } from './ChatCopyButton';
import { toolResultPresentation } from '../../../../shared/chat/toolResult';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
const serialized = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';

function ToolText({ text, markdown }: { text: string; markdown: boolean }) {
  useLanguage();
  const [index, setIndex] = useState(0);
  const { visible, page, pages } = toolOutputPage(text, index);
  return <div className="chat-tool-text">{markdown ? <div className="chat-tool-markdown">
    <ChatMarkdown text={visible} />
    <ChatCopyButton text={text} label={t("client.mobile.copyFullContent")} iconOnly />
  </div> : <ChatCodeBlock text={visible} label={t("client.chat.output")} copyText={text} copyLabel={t("client.mobile.copyFullContent")} />}
    {pages > 1 && <div className="chat-output-paging"><span>{t("client.chat.longContentIsShownInSections")}</span>
      <button type="button" disabled={!page} onClick={() => setIndex(page - 1)}>{t("client.chat.previousSection")}</button>
      <span>{page + 1}/{pages}</span>
      <button type="button" disabled={page === pages - 1} onClick={() => setIndex(page + 1)}>{t("client.chat.nextSection")}</button>
    </div>}
  </div>;
}

function OutputPart({ value }: { value: unknown }) {
  useLanguage();
  const part = record(value);
  const text = toolOutputText(value);
  if (text) return <ToolText {...text} />;
  if (part?.type === 'image' && typeof part.data === 'string' && typeof part.mimeType === 'string') {
    return <ChatImage source={`data:${part.mimeType};base64,${part.data}`} description={t("client.chat.imageReturnedByTool")} />;
  }
  if (part?.type === 'inputImage' && typeof part.imageUrl === 'string') {
    return <ChatImage source={part.imageUrl} description={t("client.chat.imageReturnedByTool")} />;
  }
  if (part?.type === 'inputAudio' && typeof part.audioUrl === 'string'
    && /^(data:audio\/|https?:\/\/)/i.test(part.audioUrl)) {
    return <audio controls preload="none" src={part.audioUrl} aria-label={t("client.chat.audioReturnedByTool")} />;
  }
  const resource = part?.type === 'resource' ? record(part.resource) ?? part : part;
  if (['resource_link', 'resource'].includes(String(part?.type)) && typeof resource?.uri === 'string') {
    return <ChatFileLink href={resource.uri}>{String(resource.name || resource.uri)}</ChatFileLink>;
  }
  return <ChatCodeBlock text={serialized(value)} label={t("client.chat.result")} language="json" copyLabel={t("client.chat.copyResult")} />;
}

export function ChatToolResult({ item }: { item: Item }) {
  useLanguage();
  const { content, structured, hasStructured, rawText } = toolResultPresentation(item);
  return <div className="chat-detail-stack">
    {item.arguments != null && <DeferredDetails summary={<summary>{t("client.chat.viewInput")}</summary>}>
      {() => <ChatCodeBlock text={serialized(item.arguments)} language="json" label={t("client.chat.input")}
        copyLabel={t("client.chat.copyInput")} />}</DeferredDetails>}
    {item.progress?.map((text, index) => <ChatMarkdown key={index} text={text} process />)}
    {hasStructured && <ChatCodeBlock text={JSON.stringify(structured, null, 2) ?? ''} language="json"
      label={t("client.mobile.structuredResult")} showCopy={false} wrapMode="always" />}
    {content?.map((part, index) => <OutputPart key={index} value={part} />)}
    {!hasStructured && !content && item.result != null && <OutputPart value={item.result} />}
    {!hasStructured && item.output != null && <OutputPart value={item.output} />}
    {item.error != null && <p role="alert" className="chat-error">
      {typeof record(item.error)?.message === 'string' ? String(record(item.error)?.message) : t("client.chat.theToolFailedPleaseTryAgain")}</p>}
    {item.result == null && item.output == null && !content && !item.error && <p className="chat-muted">
      {item.status === 'inProgress' ? t("client.chat.waitingForToolOutput") : t("client.chat.theToolReturnedNoText")}</p>}
    {hasStructured && <ChatCopyButton text={rawText} label={t("client.chat.copyRawData")} />}
  </div>;
}
