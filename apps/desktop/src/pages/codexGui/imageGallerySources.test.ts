import { expect, it } from 'vitest';
import { conversationImages } from '../../../../../shared/chat/imageGallerySources';
import type { Item } from '../../../../../shared/conversation/types';

const collect = (items: Item[], status = 'completed') => conversationImages([{ id: 'turn', status, items }]);

it('collects ordered attachments, Markdown images, local image links and generated images once', () => {
  const images = collect([
    { id: 'user', type: 'userMessage', content: [{ type: 'localImage', path: 'C:/first.png' }] },
    { id: 'reply', type: 'agentMessage', text: '![Second](https://example.test/second.png)\n'
      + '[Local](C:/third.png)\n![Again](C:/first.png)\n![Reference][photo]\n\n'
      + '[photo]: https://example.test/fourth.png\n\n'
      + '`![code](C:/hidden.png)`\n![blocked](javascript:alert)\n[Website](https://example.test/)' },
    { id: 'generated', type: 'imageGeneration', imageUrl: 'C:/last.png' },
  ]);
  expect(images.map(image => image.source)).toEqual(['C:/first.png', 'https://example.test/second.png',
    'C:/third.png', 'https://example.test/fourth.png', 'C:/last.png']);
  expect(images[1].description).toBe('Second');
});

it('includes returned tool images and process outputs while excluding structured data', () => {
  expect(collect([{ id: 'tool', type: 'mcpToolCall', result: {
    structuredContent: { type: 'inputImage', imageUrl: 'C:/structured.png' },
    content: [{ type: 'text', text: '![Not displayed](C:/structured-text.png)' },
      { type: 'image', mimeType: 'image/png', data: 'YWJj' }],
  }, processOutputs: [{ id: 'output', type: 'imageGeneration', imageUrl: 'C:/generated.png' }] }])
    .map(image => image.source)).toEqual(['data:image/png;base64,YWJj', 'C:/generated.png']);
});

it('refreshes streamed images and keeps separate conversations isolated', () => {
  const streamed: Item = { id: 'stream', type: 'agentMessage', status: 'inProgress', text: '![A](C:/a.png)' };
  expect(collect([streamed], 'inProgress')).toHaveLength(1);
  streamed.text += '\n![B](C:/b.png)';
  expect(collect([streamed], 'inProgress')).toHaveLength(2);
  expect(collect([{ id: 'other', type: 'agentMessage', text: '![C](C:/c.png)' }]))
    .toEqual([{ source: 'C:/c.png', description: 'C' }]);
});
