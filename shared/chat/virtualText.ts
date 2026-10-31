export const TEXT_CHUNK_CHARACTERS = 1_024;
export const TEXT_VIEWPORT_HEIGHT = 340;
export const TEXT_OVERSCAN = 340;

export interface TextChunk { start: number; text: string }
export interface TextMeasurement { text: string; height: number }

/** Prefer complete lines and never split a surrogate pair or CRLF across virtual rows. */
export function textChunks(text: string): TextChunk[] {
  const chunks: TextChunk[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + TEXT_CHUNK_CHARACTERS);
    const newline = text.lastIndexOf('\n', end - 1);
    if (end < text.length && newline >= start) end = newline + 1;
    if (end < text.length && /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(text.slice(end - 1, end + 1))) end--;
    if (text[end - 1] === '\r' && text[end] === '\n') end--;
    chunks.push({ start, text: text.slice(start, end) });
    start = end;
  }
  return chunks;
}

/** A block boundary already supplies the final newline; keep all other whitespace intact. */
export function chunkDisplayText(text: string) {
  return text.replace(/\r?\n$/, '') || ' ';
}

export function estimatedTextHeight(text: string, metrics: {
  width: number; characterWidth: number; lineHeight: number;
}) {
  const columns = Math.max(1, Math.floor(metrics.width / metrics.characterWidth));
  const lines = chunkDisplayText(text).split('\n').reduce((count, line) =>
    count + Math.max(1, Math.ceil([...line].reduce((width, char) => width + (char.codePointAt(0)! > 255 ? 2 : 1), 0)
      / columns)), 0);
  return lines * metrics.lineHeight;
}

export function textWindow(heights: number[], offset: number, viewport: number) {
  const offsets = [0];
  for (const height of heights) offsets.push(offsets[offsets.length - 1] + height);
  let start = 0;
  while (start < heights.length - 1 && offsets[start + 1] < offset - TEXT_OVERSCAN) start++;
  let end = start;
  while (end < heights.length && offsets[end] < offset + viewport + TEXT_OVERSCAN) end++;
  return { start, end, offsets, before: offsets[start], after: offsets[heights.length] - offsets[end] };
}
