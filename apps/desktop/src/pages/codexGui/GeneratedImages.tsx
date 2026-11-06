import { uiText } from "../../../../../shared/localization/uiText";
import type { Item } from "../../../../../shared/conversation/types";
import { generatedImageSource } from "../../../../../shared/conversation/imageSources";
import { MessageImage } from "../../../../../shared/conversation/MessageImage";
import { processOutputs } from "../../../../../shared/conversation/processDetails";

export function GeneratedImages({ items }: { items: Item[] }) {
  const sources = new Set<string>();
  for (const item of processOutputs(items)) {
    if (item.type !== "imageGeneration" || item.status !== "completed" || item.failure) continue;
    const source = generatedImageSource(item);
    if (source) sources.add(source);
  }
  if (!sources.size) return null;
  return <div aria-label={uiText("client.chat.generatedImage")}>
    {[...sources].map((source, index) => <MessageImage key={source} src={source} alt={uiText("client.composer.generatedImage", { value1: index + 1 })} />)}
  </div>;
}
