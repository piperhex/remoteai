interface ToolResultSource {
  result?: unknown;
  output?: unknown;
  contentItems?: unknown[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function isTextPart(value: unknown): boolean {
  if (typeof value === 'string') return true;
  const part = record(value);
  return part?.type === 'text' || (part?.type == null && typeof part?.text === 'string');
}

/** Prefer structured data while preserving separately returned images, audio and resources. */
export function toolResultPresentation(item: ToolResultSource) {
  const result = record(item.result);
  const structured = result?.structuredContent;
  const hasStructured = structured != null;
  const content = item.contentItems ?? (Array.isArray(result?.content) ? result.content : undefined);
  return {
    structured,
    hasStructured,
    content: hasStructured ? content?.filter(part => !isTextPart(part)) : content,
    // Keep the original envelope intact; defer potentially large serialization until copying.
    rawText: () => {
      const value = item.result ?? item.contentItems ?? item.output;
      return typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';
    },
  };
}
