import { displayText } from '../i18n/index';
import { t, useLanguage } from '../i18n';
import { useMemo } from 'react';
import type { Item } from './types';
import { messageSections } from '../../../../shared/chat/messageDetails';
import { toolText } from '../../../../shared/chat/toolText';
import { changedFiles } from '../../../../shared/chat/diff';
import { generatedImageSource } from '../../../../shared/chat/imageSources';
import { collaborationStates, collaborationStatus, collaborationSummary, isCollaborationActivity }
  from '../../../desktop/src/pages/codexGui/collaborationActivity';
import { formatTurnDuration } from './formatters';
import { ChatCodeBlock } from './ChatCodeBlock';
import { ChatMarkdown } from './ChatMarkdown';
import { ChatDiff } from './ChatDiff';
import { ChatToolResult } from './ChatToolResult';
import { ChatImage } from './ChatImage';
import { ChatFileLink } from './ChatFileLink';
import { CommandOutput } from '../../../../shared/chat/CommandOutput';
import { ChatCopyButton } from './ChatCopyButton';
import { VirtualCommandText } from './VirtualCommandText';
import { useDesktopLayout } from '../useDesktopLayout';

const FILE_CHANGE_STATUS: Record<string, string> = {
  declined: "client.chat.notApplied", failed: "client.chat.editFailed", inProgress: "client.chat.editing",
};

function SearchContent({ item }: { item: Item }) {
  useLanguage();
  return <div className="chat-detail-stack">
    {(item.action?.queries ?? [item.action?.query || item.query]).filter(Boolean).map((query, index) =>
      <p key={index}>{query}</p>)}
    {item.action?.url && /^https?:\/\//i.test(item.action.url) &&
      <ChatFileLink href={item.action.url}>{item.action.url}</ChatFileLink>}
    {item.action?.pattern && <p>{t("client.chat.find")}{item.action.pattern}</p>}
    {item.results?.map((result, index) => <article key={index}>
      <ChatFileLink href={/^https?:\/\//i.test(result.url ?? '') ? result.url : undefined}>
        {result.title || result.url}</ChatFileLink><p>{result.snippet}</p></article>)}
  </div>;
}

export function ChatToolContent({ item }: { item: Item }) {
  useLanguage();
  const desktop = useDesktopLayout();
  const text = toolText(item);
  const files = useMemo(() => item.type === 'fileChange' ? changedFiles(item.changes ?? []) : [], [item]);
  if (['agentMessage', 'reasoning', 'plan', 'enteredReviewMode', 'exitedReviewMode'].includes(item.type)) {
    return <ChatMarkdown text={text} />;
  }
  if (item.type === 'commandExecution') return <>
    <p className="chat-muted">{item.cwd}{item.durationMs != null && ` · ${formatTurnDuration(item.durationMs)}`}</p>
    {desktop ? <CommandOutput command={item.command ?? ''} label={t("client.workspaceActions.toolContent")}
      output={item.aggregatedOutput || (item.status === 'inProgress' ? t("client.chat.waitingForOutput") : t("client.chat.noTextOutput"))}
      copyCommand={<ChatCopyButton text={item.command ?? ''} label={t("client.chat.copyCommand")} iconOnly />}
      copyOutput={<ChatCopyButton text={item.aggregatedOutput ?? ''} label={t("client.chat.copyOutput")} iconOnly />} /> : <>
      <VirtualCommandText text={item.command ?? ''} label={t('client.chat.copyCommand')} command />
      <VirtualCommandText text={item.aggregatedOutput ?? ''} label={t('client.chat.copyOutput')}
        empty={item.status === 'inProgress' ? t('client.chat.waitingForOutput') : t('client.chat.noTextOutput')} />
    </>}
    {item.exitCode != null && <p className={item.exitCode ? 'chat-error' : 'chat-muted'}>{t("client.chat.exitCode")}{item.exitCode}</p>}
  </>;
  if (item.type === 'fileChange') return <ChatDiff files={files}
    status={FILE_CHANGE_STATUS[item.status ?? '']} />;
  if (['mcpToolCall', 'dynamicToolCall', 'functionCallOutput'].includes(item.type)) return <ChatToolResult item={item} />;
  if (item.type === 'webSearch') return <SearchContent item={item} />;
  if (isCollaborationActivity(item)) return <>
    <p>{collaborationSummary(item, displayText)}</p>{item.prompt && <ChatMarkdown text={item.prompt} />}
    {item.text && item.text !== item.prompt && <ChatMarkdown text={item.text} />}
    {collaborationStates(item).map((state, index) => <div key={index}>
      <p className="chat-muted">{t("client.chat.collaboration")} {index + 1} · {displayText(collaborationStatus(state.status))}</p>
      {state.message && <ChatMarkdown text={state.message} />}</div>)}
  </>;
  if (['imageView', 'imageGeneration'].includes(item.type)) return <>
    <ChatImage source={generatedImageSource(item)} compact={item.type === 'imageView'}
      description={item.type === 'imageView' ? t("client.chat.viewedImage") : t("client.chat.generatedImage")} />
    <p className="chat-muted">{item.path || item.savedPath}</p>
    {item.failure?.message && <p className="chat-error">{item.failure.message}</p>}
    {item.revisedPrompt && <ChatMarkdown text={item.revisedPrompt} />}
  </>;
  if (item.type === 'contextCompaction') return <p>{t("client.chat.earlierMessagesHaveBeenSummarizedYouCanContinueYourCurrent")}</p>;
  if (item.type === 'sleep') return <p>{t("client.chat.waitDuration")}{formatTurnDuration(item.durationMs ?? 0)}</p>;
  return <>{messageSections(item).map((section, index) => <ChatCodeBlock key={index}
    text={section.text} label={displayText(section.title)} copyLabel={t("client.accounts.copy", { value1: displayText(section.title) })} />)}</>;
}
