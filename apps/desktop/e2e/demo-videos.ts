import previewVideo from './fixtures/video-preview.mp4?url';
import type { Thread } from '../../../shared/conversation/types';
import { VIDEO_CHUNK_BYTES } from '../../../shared/remote-chat/video';

const bytes = new Uint8Array(await (await fetch(previewVideo)).arrayBuffer());
const sessions = new Set<string>();
export function seedDemoVideo(thread: Thread) {
  thread.turns = [{ id: 'video', status: 'completed', items: [
    { id: 'video-user', type: 'userMessage', text: '测试手机端视频播放。' },
    { id: 'video-answer', type: 'agentMessage',
      text: '[播放测试视频](F:/projects/demo/test.mp4)\n\n[播放超限视频](F:/projects/demo/large.mp4)' },
  ] }];
}
export function demoVideoResponse(input: Record<string, unknown>) {
  if (input.operation === 'videoOpen') {
    const id = crypto.randomUUID();
    sessions.add(id);
    return { id, size: String(input.path).endsWith('large.mp4') ? 101 * 1024 * 1024 : bytes.length,
      mimeType: 'video/mp4' };
  }
  if (input.operation === 'videoClose') { sessions.delete(String(input.id)); return null; }
  if (!sessions.has(String(input.id))) throw new Error('Video session closed');
  const offset = Number(input.offset);
  const length = Number(input.length);
  if (length <= 0 || length > VIDEO_CHUNK_BYTES) throw new Error('Invalid video read');
  const data = Array.from(bytes.subarray(offset, offset + length), (byte) => String.fromCharCode(byte)).join('');
  return { offset, data: btoa(data) };
}
