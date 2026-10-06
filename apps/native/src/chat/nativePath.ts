import { NativeModules } from 'react-native';
import { NativePath, type NativePathFactory, type NativePathEvent } from '../../../../shared/remote-chat/nativePath';

interface ConnectivityModule { bulkBinaryAvailable?: boolean; call(request: string): Promise<string> }
const connectivity = NativeModules.ChatConnectivity as ConnectivityModule | undefined;

async function call<T>(request: object): Promise<T> {
  if (!connectivity) throw new Error('Native connection unavailable');
  const response = JSON.parse(await connectivity.call(JSON.stringify(request))) as { data: T; error?: string };
  if (response.error) throw new Error('Native connection unavailable');
  return response.data;
}

export const localChatAddresses = () => call<string[]>({ operation: 'addresses' });

/** Older installed native binaries keep their existing transport until rebuilt with the module. */
export const createMobileNativePath: NativePathFactory | undefined = connectivity ? options => {
  let stopped = false;
  return new NativePath(options, {
    open: async (input, receive) => {
      const id = await call<string>({ operation: 'open',
        bulk: Boolean(input.bulkChannel && connectivity.bulkBinaryAvailable),
        config: { ...input.config, sessionId: input.sessionId, desktop: input.desktop },
      });
      const poll = async () => {
        while (!stopped) {
          const event = await call<NativePathEvent | null>({ operation: 'poll', id });
          if (stopped) return;
          if (event) receive(event);
          if (event?.type === 'closed') return;
        }
      };
      void poll().catch(() => { if (!stopped) receive({ type: 'closed' }); });
      return id;
    },
    send: (id, text) => call<void>({ operation: 'send', id, text }),
    renew: (id, expiresAt) => call<void>({ operation: 'renew', id, expires_at: expiresAt }),
    mediaOpen: (id, viewId) => call({ operation: 'media-open', id, view_id: viewId }),
    mediaStatus: (id, viewId) => call({ operation: 'media-status', id, view_id: viewId }),
    mediaClose: (id, viewId) => call({ operation: 'media-close', id, view_id: viewId }),
    close: id => { stopped = true; return call<void>({ operation: 'close', id }); },
  });
} : undefined;
