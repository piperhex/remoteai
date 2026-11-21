import { afterEach, expect, it, vi } from 'vitest';
import { readCliDetail } from '../../../shared/cli-gui/readDetail';
import type { CliDetailPart, CliDetailResponse, CliHistory, CliRequest, CliTransport } from '../../../shared/cli-gui/types';
import { CliDetailTransfers } from './detailTransfers';
import { MAX_FRAME_BYTES, workerFrame } from './workerFrame';
import { CliService } from './service';
import type { PaseoClient } from '@getpaseo/client';

const request = { engine: 'claude', action: 'read', id: 'thread', detailId: '42' } as const;
const entry = { id: '42', role: 'tool', first: 42, last: 43, text: '测😀试\n'.repeat(900_000) } as const;
const history: CliHistory = { session: { id: 'thread', engine: 'claude', status: 'idle', model: '', title: '',
  cwd: '', updatedAt: '', archived: false, permissions: [] }, entries: [], cursor: { epoch: 'one', seq: 42 }, hasOlder: true };
afterEach(() => vi.useRealTimers());

it('reassembles a multi-byte CLI detail larger than a worker frame and releases the snapshot', async () => {
  const transfers = new CliDetailTransfers();
  const tokens = new Set<string>();
  const transport: CliTransport = { subscribe: () => () => {}, request: async <T,>(input: CliRequest) => {
    if (input.action !== 'read') throw new Error('unexpected action');
    const result = input.detailChunk ? transfers.read(input) : transfers.open(input, history, entry);
    if ('detailPart' in result) tokens.add((result.detailPart as CliDetailPart).token);
    const frame = workerFrame({ id: 1, data: result });
    expect(Buffer.byteLength(frame)).toBeLessThan(MAX_FRAME_BYTES);
    return JSON.parse(frame).data as T;
  } };
  try {
    const result = await readCliDetail(transport, request, history);
    expect(result.item.aggregatedOutput).toBe(entry.text);
    expect(tokens.size).toBe(1);
    const [token] = tokens;
    expect(() => transfers.read({ ...request, detailChunk: { token, offset: 0 } })).toThrow();
  } finally { transfers.close(); }
});

it('rejects a mismatched owner or entry and expires an abandoned transfer', () => {
  vi.useFakeTimers();
  const transfers = new CliDetailTransfers();
  const response = transfers.open(request, history, entry);
  expect(response).toHaveProperty('detailPart');
  const { token } = (response as Extract<CliDetailResponse, { detailPart: CliDetailPart }>).detailPart;
  const read = { ...request, detailChunk: { token, offset: 0 } };
  for (const other of [{ id: 'other' }, { detailId: '99' }, { engine: 'gemini' as const }]) {
    expect(() => transfers.read({ ...read, ...other })).toThrow();
  }
  vi.advanceTimersByTime(60_001);
  expect(() => transfers.read(read)).toThrow();
  transfers.close();
});

it('returns an error for one oversized unprojected legacy response and can write the next frame', () => {
  expect(JSON.parse(workerFrame({ id: 1, data: entry }))).toEqual({ id: 1, error: 'client.cliGui.requestFailed' });
  expect(JSON.parse(workerFrame({ id: 2, data: 'ok' }))).toEqual({ id: 2, data: 'ok' });
});

it('projects a large timeline before the bridge and resolves it through the real service without rereading each chunk', async () => {
  const agent = { ...history.session, labels: { remoteai: 'cli-gui', remoteaiClaudeAccount: 'account' },
    provider: 'claude', pendingPermissions: [], archivedAt: 'archived' };
  const refetch = vi.fn(async () => ({ agent, startCursor: history.cursor, hasOlder: true, entries: [{
    seqStart: entry.first, seqEnd: entry.last, item: { type: 'assistant_message', text: entry.text },
  }] }));
  const handle = { id: request.id, archivedAt: 'archived', refresh: async () => ({ agent }), timeline: { refetch } };
  const client = { agents: { ref: () => handle } } as unknown as PaseoClient;
  const service = new CliService({ root: '/unused-runtime', connect: async () => client,
    status: async () => ({ status: 'ready', version: 'test' }), install() {}, close: async () => {},
    accountBridge: async () => { throw new Error('unexpected account read'); } }, () => {});
  const transport: CliTransport = { subscribe: () => () => {}, request: async <T,>(input: CliRequest) => {
    const frame = JSON.parse(workerFrame({ id: 1, data: await service.request(input) }));
    expect(frame.error).toBeUndefined();
    return frame.data as T;
  } };
  try {
    const initial = await transport.request<CliHistory>({ ...request, detailId: undefined, previews: true });
    const preview = initial.entries[0];
    expect(preview.text.length).toBeLessThan(17 * 1024);
    const loaded = await readCliDetail(transport, { ...request, cursor: preview.detailCursor }, initial);
    expect(loaded.item.text).toEqual(entry.text);
    expect(refetch).toHaveBeenCalledTimes(2);
  } finally { await service.close(); }
});
