import { describe, expect, it } from 'vitest';
import { chunkDisplayText, estimatedTextHeight, textChunks, textWindow,
  TEXT_CHUNK_CHARACTERS } from '../../../../shared/chat/virtualText';

describe('virtual command output', () => {
  it.each(['\n', '\r\n'])('preserves complete output and line boundaries with %j', newline => {
    const text = Array.from({ length: 1_000 }, (_, i) => `文件 ${i} 🙂${newline}`).join('');
    const chunks = textChunks(text);
    expect(chunks.map(chunk => chunk.text).join('')).toBe(text);
    expect(chunks.every(chunk => chunk.text.length <= TEXT_CHUNK_CHARACTERS)).toBe(true);
    expect(chunks.slice(0, -1).every(chunk => chunk.text.endsWith(newline))).toBe(true);
    expect(chunks[1].start).toBe(chunks[0].text.length);
  });

  it('handles long single lines, surrogate boundaries, empty text and unmatched surrogate code units', () => {
    for (const suffix of ['🙂末尾', '\ud83d', '\r\n末尾']) {
      const text = 'a'.repeat(TEXT_CHUNK_CHARACTERS - 1) + suffix;
      const chunks = textChunks(text);
      expect(chunks.map(chunk => chunk.text).join('')).toBe(text);
      expect(chunks.slice(0, -1).some(chunk => /[\ud800-\udbff]$/.test(chunk.text))).toBe(false);
    }
    expect(textChunks('')).toEqual([]);
    expect(textChunks('\ud83d')).toEqual([{ start: 0, text: '\ud83d' }]);
    expect(chunkDisplayText('  a  \r\n')).toBe('  a  ');
  });

  it('recycles earlier rows while scrolling through all output without a page-size cap', () => {
    const heights = Array.from({ length: 1_000 }, () => 200);
    const first = textWindow(heights, 0, 340);
    const next = textWindow(heights, 8_000, 340);
    const last = textWindow(heights, 199_660, 340);
    expect(first.start).toBe(0);
    expect(next.start).toBeGreaterThan(first.end);
    expect(next.end - next.start).toBeLessThan(8);
    expect(last.end).toBe(1_000);
    expect(next.before + heights.slice(next.start, next.end).reduce((a, b) => a + b, 0) + next.after)
      .toBe(200_000);
  });

  it('increases estimates for narrower screens and enlarged Chinese text', () => {
    const text = '检查输出'.repeat(100);
    const metrics = { width: 320, characterWidth: 8, lineHeight: 24 };
    expect(estimatedTextHeight(text, { ...metrics, width: 200 })).toBeGreaterThan(estimatedTextHeight(text, metrics));
    expect(estimatedTextHeight(text, { ...metrics, characterWidth: 10, lineHeight: 30 }))
      .toBeGreaterThan(estimatedTextHeight(text, metrics));
  });
});
