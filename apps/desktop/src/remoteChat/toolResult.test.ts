import { describe, expect, it, vi } from 'vitest';
import { toolResultPresentation } from '../../../../shared/chat/toolResult';

describe('structured tool results', () => {
  it('replaces raw text, preserves media and copies the complete original envelope on demand', () => {
    const image = { type: 'image', data: 'image', mimeType: 'image/png' };
    const resource = { type: 'resource_link', uri: 'https://example.com' };
    const result = { content: [{ type: 'text', text: 'raw' }, image, resource],
      structuredContent: { text: '**literal data**', count: 2 }, isError: false };
    const serialize = vi.fn(() => result);
    const presentation = toolResultPresentation({ result: { ...result, toJSON: serialize } });
    expect(presentation.structured).toEqual(result.structuredContent);
    expect(presentation.content).toEqual([image, resource]);
    expect(serialize).not.toHaveBeenCalled();
    expect(presentation.rawText()).toBe(JSON.stringify(result, null, 2));
    expect(serialize).toHaveBeenCalledTimes(1);
  });

  it.each([false, 0, '', [], {}])('does not drop an empty structured value: %j', structuredContent => {
    const presentation = toolResultPresentation({ result: { structuredContent } });
    expect(presentation.hasStructured).toBe(true);
    expect(presentation.structured).toEqual(structuredContent);
  });

  it('keeps ordinary output unchanged and respects contentItems', () => {
    const contentItems = [{ type: 'text', text: 'streamed text' }];
    expect(toolResultPresentation({ contentItems, result: { content: [] } }).content).toBe(contentItems);
    expect(toolResultPresentation({ result: 'raw string' }).rawText()).toBe('raw string');
    expect(toolResultPresentation({ result: { structuredContent: null } }).hasStructured).toBe(false);
  });
});
