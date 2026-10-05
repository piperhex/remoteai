import { decodeRelay, encodeRelay } from '../relayWire';
import { decodeBulkRelay, isBulkRelay } from '../bulkRelayWire';

/** A signalling socket can be owned by the browser or by a native credential broker. */
export interface ChatSocket {
  readonly bulkAvailable?: boolean;
  onbulk?: ((sessionId: string, bytes: Uint8Array) => void) | null;
  readonly readyState: number;
  readonly bufferedAmount: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export function browserChatSocket(url: string): ChatSocket {
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  let binaryRelay = false;
  let bulkAvailable = false;
  const bridge: ChatSocket = {
    get readyState() { return socket.readyState; },
    get bufferedAmount() { return socket.bufferedAmount; },
    get bulkAvailable() { return bulkAvailable; },
    onbulk: null,
    onopen: null, onmessage: null, onclose: null, onerror: null,
    send: (data) => socket.send(binaryRelay ? encodeRelay(data) : data), close: () => socket.close(),
  };
  socket.onopen = () => bridge.onopen?.();
  socket.onmessage = (event) => {
    try {
      if (event.data instanceof ArrayBuffer && isBulkRelay(event.data)) {
        if (!bulkAvailable) throw new Error('Bulk not negotiated');
        const { sessionId, record } = decodeBulkRelay(event.data);
        bridge.onbulk?.(sessionId, record); return;
      }
      const data = event.data instanceof ArrayBuffer ? decodeRelay(event.data) : event.data;
      if (typeof data !== 'string') throw new Error('Invalid frame');
      if (supportsBinary(data)) binaryRelay = true;
      if (supportsBulk(data)) bulkAvailable = true;
      bridge.onmessage?.({ data });
    } catch { socket.close(); bridge.onerror?.(); }
  };
  socket.onclose = (event) => bridge.onclose?.(event);
  socket.onerror = () => bridge.onerror?.();
  return bridge;
}

function supportsBinary(data: string) {
  try {
    const frame = JSON.parse(data) as Record<string, unknown> | null;
    return frame?.type === 'chat-policy' && frame.binaryRelay === true;
  } catch { return false; } // The connection validates text frames and reports its existing protocol error.
}

function supportsBulk(data: string) {
  try {
    const frame = JSON.parse(data) as { type?: string; fileBulkV1?: boolean } | null;
    return frame?.type === 'chat-policy' && frame.fileBulkV1 === true;
  } catch { return false; }
}
