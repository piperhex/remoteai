import { uiText } from "../../../../../shared/localization/uiText";
import type { Item } from "../../../../../shared/conversation/types";
import { RichText } from "../../../../../shared/conversation/RichText";
import { MessageImage } from "../../../../../shared/conversation/MessageImage";
import { MessageLink } from "../../../../../shared/conversation/MessageLink";
import { CopyButton } from "../../../../../shared/conversation/CopyButton";
import { formatTurnDuration } from "../../../../../shared/conversation/turnTiming";
import styles from "./ActivityRow.module.less";
import { generatedImageSource } from "../../../../../shared/conversation/imageSources";
import { DeferredDetails } from "./DeferredDetails";
import { ToolText } from "./ToolText";
import { CollaborationDetails } from "./CollaborationDetails";
import { isCollaborationActivity } from "../../../../../shared/conversation/collaborationActivity";
import { CommandOutput } from "../../../../../shared/chat/CommandOutput";
import { toolResultPresentation } from "../../../../../shared/chat/toolResult";
import { DeferredToolDetails } from "../../../../../shared/chat/DeferredToolDetails";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function serialized(value: unknown) { return typeof value === "string" ? value : JSON.stringify(value, null, 2); }

function OutputPart({ value }: { value: unknown }) {
  const part = record(value);
  if (typeof part?.text === "string") return <ToolText text={part.text} markdown />;
  if (part?.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string") {
    return <MessageImage src={`data:${part.mimeType};base64,${part.data}`} alt={uiText("client.chat.imageReturnedByTool")} />;
  }
  if (part?.type === "inputImage" && typeof part.imageUrl === "string") {
    return <MessageImage src={part.imageUrl} alt={uiText("client.chat.imageReturnedByTool")} />;
  }
  if (part?.type === "inputAudio" && typeof part.audioUrl === "string"
    && /^(https?:\/\/|data:audio\/(?:mp3|mpeg|wav|ogg);base64,)/i.test(part.audioUrl)) {
    return <audio controls preload="none" src={part.audioUrl} aria-label={uiText("client.chat.audioReturnedByTool")} />;
  }
  if ((part?.type === "resource_link" || part?.type === "resource") && typeof part.uri === "string") {
    return <MessageLink href={part.uri}>{typeof part.name === "string" ? part.name : part.uri}</MessageLink>;
  }
  return <ToolText text={serialized(value) ?? ""} />;
}

function ToolResult({ item }: { item: Item }) {
  const { content, structured, hasStructured, rawText } = toolResultPresentation(item);
  return <>
    {item.arguments != null && <DeferredDetails className={styles.payload} summary={<summary>{uiText("client.chat.input")}</summary>}>
      {() => <><ToolText text={serialized(item.arguments) ?? ""} />
        <CopyButton text={serialized(item.arguments) ?? ""} label={uiText("client.workspaceActions.copyToolInput")} /></>}
    </DeferredDetails>}
    {item.progress?.map((text, index) => <p key={index}>{text}</p>)}
    {hasStructured && <ToolText text={JSON.stringify(structured, null, 2) ?? ""} showCopy={false} />}
    {content?.map((part, index) => <OutputPart key={index} value={part} />)}
    {!hasStructured && !content && item.result != null && <OutputPart value={item.result} />}
    {!hasStructured && item.output != null && <OutputPart value={item.output} />}
    {item.error != null && <div className={styles.failure} role="status">
      {typeof record(item.error)?.message === "string" ? String(record(item.error)?.message) : uiText("client.chat.theToolFailedPleaseTryAgain")}
    </div>}
    {item.result == null && item.output == null && !content && !item.error && <p className={styles.emptyBody}>
      {item.status === "inProgress" ? uiText("client.chat.waitingForToolOutput") : uiText("client.chat.theToolReturnedNoText")}</p>}
    {hasStructured && <div className={styles.outputActions}>
      <CopyButton text={rawText} label={uiText("client.chat.copyRawData")} showLabel />
    </div>}
  </>;
}

export function ToolDetails({ item, text }: { item: Item; text: string }) {
  return <DeferredToolDetails item={item}>{loaded => <ToolDetailsBody item={loaded} text={text} />}</DeferredToolDetails>;
}

function ToolDetailsBody({ item, text }: { item: Item; text: string }) {
  if (["reasoning", "plan", "enteredReviewMode", "exitedReviewMode"].includes(item.type)) {
    return <ToolText text={text} markdown />;
  }
  if (item.type === "sleep") return <p>{uiText("client.chat.waitDuration")}{formatTurnDuration(item.durationMs ?? 0)}</p>;
  if (item.type === "contextCompaction") return <p>{uiText("client.chat.earlierMessagesHaveBeenSummarizedYouCanContinueYourCurrent")}</p>;
  if (item.type === "commandExecution") return <>
    <div className={styles.commandToolbar}><span>{item.cwd}</span>
      {item.durationMs != null && <span>{formatTurnDuration(item.durationMs)}</span>}</div>
    <CommandOutput command={item.command ?? ""} label={uiText("client.workspaceActions.toolContent")}
      output={item.aggregatedOutput || (item.status === "inProgress" ? uiText("client.chat.waitingForOutput") : uiText("client.chat.noTextOutput"))}
      copyCommand={<CopyButton text={item.command ?? ""} label={uiText("client.chat.copyCommand")} />}
      copyOutput={<CopyButton text={item.aggregatedOutput ?? ""} label={uiText("client.chat.copyOutput")} />} />
    {item.exitCode != null && <div className={styles.commandToolbar}>{uiText("client.chat.exitCode")}{item.exitCode}</div>}
  </>;
  if (["mcpToolCall", "dynamicToolCall", "functionCallOutput"].includes(item.type)) return <ToolResult item={item} />;
  if (item.type === "webSearch") return <>
    {(item.action?.queries ?? [item.action?.query || item.query]).filter(Boolean).map((query, index) =>
      <p key={index}>{query}</p>)}
    {item.action?.url && <MessageLink href={item.action.url}>{item.action.url}</MessageLink>}
    {item.action?.pattern && <p>{uiText("client.chat.find")}{item.action.pattern}</p>}
    {item.results?.map((result, index) => <div key={index} className={styles.searchResult}>
      <MessageLink href={result.url}>{result.title || result.url}</MessageLink>
      {result.snippet && <p>{result.snippet}</p>}</div>)}
  </>;
  if (item.type === "imageView" || item.type === "imageGeneration") return <>
    {item.type === "imageView" && <MessageImage src={generatedImageSource(item)} alt={uiText("client.chat.viewedImage")} compact />}
    {(item.path || item.savedPath) && <MessageLink href={item.path || item.savedPath}>
      {item.path || item.savedPath}</MessageLink>}
    {item.failure?.message && <p className={styles.failure}>{item.failure.message}</p>}
    {item.revisedPrompt && <RichText text={item.revisedPrompt} />}
  </>;
  if (isCollaborationActivity(item)) return <CollaborationDetails item={item} />;
  return <ToolText text={text || serialized(item) || ""} />;
}
