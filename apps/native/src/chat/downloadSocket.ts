import { DeviceEventEmitter, NativeModules } from 'react-native';
import { getRandomBytes } from 'expo-crypto';
import type { ChatSocket } from '../../../../shared/remote-chat/client/socket';

interface SocketNative {
  open: (id: string, url: string) => Promise<void>;
  send: (id: string, text: string) => Promise<void>; close: (id: string) => void;
}
interface SocketEvent { id: string; type: string; data: string; code: number }

export function nativeDownloadSocket(url: string): ChatSocket {
  const native = NativeModules.DownloadChatSocket as SocketNative;
  const hex = [...getRandomBytes(16)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  let state = 0; let buffered = 0; let bulk = false;
  const socket: ChatSocket = {
    get readyState() { return state; }, get bufferedAmount() { return buffered; },
    get bulkAvailable() { return bulk; }, onopen: null, onmessage: null, onclose: null, onerror: null,
    send: data => {
      if (state !== 1) throw new Error('Disconnected');
      buffered += data.length;
      void native.send(id, data).catch(() => socket.onerror?.()).finally(() => { buffered -= data.length; });
    },
    close: () => { if (state === 3) return; state = 3; subscription.remove(); native.close(id); },
  };
  const subscription = DeviceEventEmitter.addListener('downloadSocket', (event: SocketEvent) => {
    if (event.id !== id || state === 3) return;
    if (event.type === 'open') { state = 1; socket.onopen?.(); }
    if (event.type === 'close') { state = 3; subscription.remove(); socket.onclose?.({ code: event.code }); }
    if (event.type === 'message') {
      try {
        const value = JSON.parse(event.data) as { type?: string; fileBulkV1?: boolean };
        if (value.type === 'chat-policy') bulk = value.fileBulkV1 === true;
        socket.onmessage?.({ data: event.data });
      } catch { socket.close(); socket.onerror?.(); }
    }
  });
  void native.open(id, url).catch(() => { socket.close(); socket.onerror?.(); });
  return socket;
}
