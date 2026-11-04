// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '../api/backend';
import { RemoteDictation } from './dictation';
import { ChatOperations } from './operations';
import { ChatRpc } from '../../../../shared/remote-chat/rpc';
import { createRemoteDictationClient } from '../../../../shared/remote-chat/dictation';

vi.mock('../api/backend', () => ({ invoke: vi.fn(), hasLocalBackend: false }));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));
vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), respond: vi.fn() } }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(invoke).mockImplementation(async command => command === 'codex_gui_dictation_prepare'
    ? { sessionId: 'session' } : { text: '转写结果' });
});
afterEach(() => vi.useRealTimers());
const audio = { action: 'transcribe', sessionId: 'session', data: 'GkXfow==', mimeType: 'audio/webm' };

it('transports browser audio through the remote RPC and native adapter', async () => {
  const operations = new ChatOperations();
  const rpc = new ChatRpc({ prefix: 'browser', event: () => {}, send: async request => {
    if (request.kind === 'request') rpc.receive(await operations.execute(request, 'relay', 'browser'));
  } });
  const client = createRemoteDictationClient({ request: body => rpc.request('request', body),
    subscribeAccountChange: () => () => {} });
  const { sessionId } = await client.prepare();
  await expect(client.transcribe(sessionId, new Blob(['audio'], { type: 'audio/webm' })))
    .resolves.toEqual({ text: '转写结果' });
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_dictation_transcribe',
    { request: { sessionId, data: 'YXVkaW8=', mimeType: 'audio/webm' } });
  rpc.close(); operations.release();
});

it('uses native dictation and deduplicates delivery retries across transport paths', async () => {
  const operations = new ChatOperations();
  const request = { kind: 'request' as const, method: 'request' as const, id: 'prepare',
    body: { operation: 'dictation', action: 'prepare' } };
  const [first, retried] = await Promise.all([
    operations.execute(request, 'relay', 'browser'), operations.execute(request, 'direct', 'browser'),
  ]);
  expect(first).toEqual(retried);
  expect(first.data).toEqual({ sessionId: 'session' });
  expect(invoke).toHaveBeenCalledTimes(1);
  const transcription = { ...request, id: 'transcribe', body: { operation: 'dictation', ...audio } };
  expect((await operations.execute(transcription, 'relay', 'stranger')).error).toContain('Expired');
  expect((await operations.execute(transcription, 'relay', 'browser')).data).toEqual({ text: '转写结果' });
  expect((await operations.execute(transcription, 'direct', 'browser')).data).toEqual({ text: '转写结果' });
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_dictation_transcribe', {
    request: { sessionId: 'session', data: audio.data, mimeType: audio.mimeType },
  });
  operations.release();
});

it('keeps failed audio retryable and cancels only sessions belonging to the caller', async () => {
  const host = new RemoteDictation();
  await host.request({ action: 'prepare' }, 'browser');
  await expect(host.request({ action: 'cancel', sessionId: 'session' }, 'stranger')).rejects.toThrow();
  vi.mocked(invoke).mockRejectedValueOnce('转写失败，请重试。');
  await expect(host.request(audio, 'browser')).rejects.toBe('转写失败，请重试。');
  await expect(host.request(audio, 'browser')).resolves.toEqual({ text: '转写结果' });
});

it.each([{ ...audio, data: '' }, { ...audio, data: 'a'.repeat(14 * 1024 * 1024) },
  { ...audio, mimeType: 'text/plain' }, { ...audio, data: {} }])('rejects malformed audio before IPC', async body => {
  const host = new RemoteDictation();
  await host.request({ action: 'prepare' }, 'browser');
  await expect(host.request(body, 'browser')).rejects.toThrow();
  expect(invoke).toHaveBeenCalledTimes(1);
  host.release();
});

it('cancels native preparation that finishes after its owner disconnected', async () => {
  let prepared!: (value: { sessionId: string }) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise(resolve => { prepared = resolve; }));
  const host = new RemoteDictation();
  const result = host.request({ action: 'prepare' }, 'browser');
  host.release('browser');
  prepared({ sessionId: 'late' });
  await expect(result).rejects.toThrow();
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_dictation_cancel', { sessionId: 'late' });
});

it('expires abandoned sessions and releases their native resources', async () => {
  vi.useFakeTimers();
  const host = new RemoteDictation();
  await host.request({ action: 'prepare' }, 'browser');
  vi.advanceTimersByTime(10 * 60_000);
  await expect(host.request(audio, 'browser')).rejects.toThrow();
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_dictation_cancel', { sessionId: 'session' });
});

it('allows transcription longer than an ordinary RPC without resending it', async () => {
  vi.useFakeTimers();
  const send = vi.fn(async () => {});
  const rpc = new ChatRpc({ send, event: () => {}, prefix: 'voice' });
  const result = rpc.request('request', { operation: 'dictation', ...audio });
  vi.advanceTimersByTime(125_000);
  rpc.receive({ kind: 'response', id: 'voice:1', data: { text: '完成' } });
  await expect(result).resolves.toEqual({ text: '完成' });
  expect(send).toHaveBeenCalledOnce();
  rpc.close();
});
