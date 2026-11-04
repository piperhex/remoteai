import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_CHAT_POLICY, MIB, setChatPolicy } from '../../../../../shared/remote-chat/policy';
import { invoke } from '../../api/backend';
import { guiApi } from '../../../../../shared/conversation/api';
import type { Request } from '../../../../../shared/conversation/types';

vi.mock('../../api/backend', () => ({ invoke: vi.fn(async () => ({ data: {} })), isHostedWebApp: false }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
vi.mock('../../../../../shared/conversation/webEvents', () => ({ subscribeGuiEvent: vi.fn() }));
afterEach(() => { setChatPolicy(DEFAULT_CHAT_POLICY); vi.clearAllMocks(); });
const attachment = { kind: 'file' as const, name: 'notes.txt', path: '',
  data: Buffer.alloc(2 * MIB + 1, 1).toString('base64') };

it.each(['send', 'steer', 'sendBatch'] as const)('checks the latest upload policy before %s reaches IPC', async (operation) => {
  const message = { text: '', images: [], skills: [], attachments: [attachment] };
  const request: Request = { operation, threadId: 'chat', turnId: 'turn', access: 'read-only',
    ...message, messages: [message] };
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, fileUploadMaxMb: 3 });
  await guiApi.request(request);
  expect(invoke).toHaveBeenCalledTimes(1);
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, fileUploadMaxMb: 1 });
  await expect(guiApi.request(request)).rejects.toThrow('1 MB');
  expect(invoke).toHaveBeenCalledTimes(1);
});

it('bounds the combined bytes of a batch before creating any files', async () => {
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, fileUploadMaxMb: 100 });
  const message = { text: '', images: [], skills: [], attachments: [attachment] };
  await expect(guiApi.request({ operation: 'sendBatch', threadId: 'chat', access: 'read-only',
    model: 'test', effort: 'high', messages: [message, message] })).rejects.toThrow('文件合计不能超过 3 MB');
  expect(invoke).not.toHaveBeenCalled();
});

it('retains P2P upload acceptance in queued batches without exempting Relay messages', async () => {
  const direct = { text: '', images: [], skills: [], attachments: [attachment], transferMode: 'direct' as const };
  const request: Request = { operation: 'sendBatch', threadId: 'chat', access: 'read-only',
    messages: [direct, direct] };
  await guiApi.request(request);
  expect(invoke).toHaveBeenCalledTimes(1);
  request.messages.push({ ...direct, transferMode: 'relay' });
  await expect(guiApi.request(request)).rejects.toThrow('2 MB');
  expect(invoke).toHaveBeenCalledTimes(1);
});
