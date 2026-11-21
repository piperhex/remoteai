import { randomUUID } from 'node:crypto';
import type { CliDetailResponse, CliEntry, CliHistory, CliRequest } from '../../../shared/cli-gui/types';
import { CLI_DETAIL_CHUNK_CHARS, CLI_DETAIL_MAX_CHARS } from '../../../shared/cli-gui/types';

type Read = Extract<CliRequest, { action: 'read' }>;
const MAX_TRANSFERS = 4;
const IDLE_MS = 60_000;
const identity = (request: Read) => JSON.stringify([request.engine, request.id, request.detailId]);
interface Transfer { key: string; data: string; epoch?: string; timer: NodeJS.Timeout }

/** Keep a stable snapshot while the drawer reads its exact entry through the worker's 8 MiB line protocol. */
export class CliDetailTransfers {
  private readonly values = new Map<string, Transfer>();
  private chars = 0;

  open(request: Read, history: CliHistory, entry: CliEntry): CliDetailResponse {
    const data = JSON.stringify(entry);
    if (data.length <= CLI_DETAIL_CHUNK_CHARS) return { ...history, entries: [entry] };
    if (this.values.size >= MAX_TRANSFERS || data.length + this.chars > CLI_DETAIL_MAX_CHARS) {
      throw new Error('client.cliGui.historyFailed');
    }
    const token = randomUUID();
    const timer = setTimeout(() => this.release(token), IDLE_MS);
    timer.unref();
    const value = { key: identity(request), data, epoch: history.cursor?.epoch, timer };
    this.values.set(token, value);
    this.chars += data.length;
    return this.part(token, value, 0);
  }

  read(request: Read) {
    const { token, offset } = request.detailChunk!;
    const value = this.values.get(token);
    if (!value || value.key !== identity(request)) throw new Error('client.cliGui.historyFailed');
    if (offset === undefined) { this.release(token); return {}; }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= value.data.length || offset % CLI_DETAIL_CHUNK_CHARS) {
      throw new Error('client.cliGui.invalidRequest');
    }
    value.timer.refresh();
    return this.part(token, value, offset);
  }

  private part(token: string, value: Transfer, offset: number): CliDetailResponse {
    return { detailPart: { token, offset, epoch: value.epoch, total: value.data.length,
      text: value.data.slice(offset, offset + CLI_DETAIL_CHUNK_CHARS) } };
  }

  private release(token: string) {
    const value = this.values.get(token);
    if (!value) return;
    clearTimeout(value.timer);
    this.values.delete(token);
    this.chars -= value.data.length;
  }

  close() { for (const token of this.values.keys()) this.release(token); }
}
