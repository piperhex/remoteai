import { BULK_LIMITS } from './bulkLimits';
import type { BinaryChannel } from './bulkTransport';

export function binaryDataChannel(channel: RTCDataChannel, maximum?: () => number | undefined): BinaryChannel {
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = BULK_LIMITS.transportLowBytes;
  return {
    get maxRecordBytes() { return maximum?.(); },
    get readyState() { return channel.readyState; },
    get bufferedAmount() { return channel.bufferedAmount; },
    send: bytes => channel.send(bytes), close: () => channel.close(),
    onOpen: callback => channel.addEventListener('open', callback),
    onMessage: callback => channel.addEventListener('message', event => {
      if (event.data instanceof ArrayBuffer) callback(new Uint8Array(event.data));
      else channel.close();
    }),
    onLow: callback => {
      channel.addEventListener('bufferedamountlow', callback);
      return () => channel.removeEventListener('bufferedamountlow', callback);
    },
    onClose: callback => {
      channel.addEventListener('close', callback); channel.addEventListener('error', callback);
    },
  };
}
