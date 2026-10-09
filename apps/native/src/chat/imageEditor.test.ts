import { describe, expect, it } from 'vitest';
import { editedImageMessage, imageEditorHtml } from '../../../../shared/chat/imageEditorHtml';
import { MAX_CHAT_IMAGE_CHARS } from '../../../../shared/remote-chat/attachments';

const image = 'data:image/jpeg;base64,aW1hZ2U=';

describe('image editor boundary', () => {
  it('accepts saved image data and ignores unrelated messages', () => {
    expect(editedImageMessage(JSON.stringify({ type: 'save', dataUrl: image }))).toBe(image);
    for (const message of [null, {}, { type: 'cancel' }, { type: 'save', dataUrl: 12 }]) {
      expect(editedImageMessage(JSON.stringify(message))).toBeNull();
    }
  });

  it('rejects remote URLs, invalid image data and oversized results', () => {
    for (const dataUrl of ['https://example.test/image.jpg', 'data:text/html;base64,aA==',
      'data:image/jpeg;base64,invalid<script>', image + 'a'.repeat(MAX_CHAT_IMAGE_CHARS)]) {
      expect(() => editedImageMessage(JSON.stringify({ type: 'save', dataUrl }))).toThrow();
      expect(() => imageEditorHtml(dataUrl)).toThrow();
    }
  });

  it('allows local images above the relay limit without changing remote limits', () => {
    const dataUrl = 'data:image/png;base64,' + 'a'.repeat(MAX_CHAT_IMAGE_CHARS);
    const message = JSON.stringify({ type: 'save', dataUrl });
    expect(imageEditorHtml(dataUrl, undefined, undefined, { mode: 'direct' })).toContain(dataUrl);
    expect(editedImageMessage(message, 'direct')).toBe(dataUrl);
    expect(() => imageEditorHtml(dataUrl)).toThrow();
    expect(() => editedImageMessage(message)).toThrow();
    expect(() => imageEditorHtml('https://example.test/image.png', undefined, undefined,
      { mode: 'direct' })).toThrow();
  });
});
