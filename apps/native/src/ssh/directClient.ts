import type { GuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import type { SshProfileStore } from '../../../../shared/terminal/sshProfiles';
import type { TerminalInfo, TerminalRead } from '../../../../shared/terminal/types';
import type { SshFileReply } from '../../../../shared/terminal/ssh';

export interface DirectSshBridge { call: (request: string) => Promise<string> }

/** Owns only this phone's sessions; no device ID, chat controller or relay is involved. */
export function createDirectSshClient(options: {
  bridge?: DirectSshBridge; scope: string; profiles: SshProfileStore;
}) {
  let disposed = false;
  const pending = new Set<Promise<unknown>>();
  const send = async <T>(request: object): Promise<T> => {
    if (!options.bridge) throw new Error('client.ssh.nativeUpdateRequired');
    const reply: unknown = JSON.parse(await options.bridge.call(JSON.stringify({ scope: options.scope, request })));
    if (!reply || typeof reply !== 'object') throw new Error('client.ssh.connectionFailed');
    if ('error' in reply && typeof reply.error === 'string') throw new Error(reply.error);
    if (!('data' in reply)) throw new Error('client.ssh.connectionFailed');
    return reply.data as T;
  };
  const call = <T>(request: object): Promise<T> => {
    if (disposed) return Promise.reject(new Error('client.ssh.closed'));
    const result = send<T>(request);
    pending.add(result);
    void result.then(() => pending.delete(result), () => pending.delete(result));
    return result;
  };
  const command = (request: object) => call<void>({ type: 'command', request });
  const client: GuiToolsClient['terminal'] = {
    ssh: {
      profiles: options.profiles,
      probe: endpoint => call<string>({ type: 'probe', endpoint }),
      open: request => {
        // Desktop X11 preferences remain saved, but a phone has no local X server.
        const { x11: _x11, ...direct } = request;
        return call<TerminalInfo>({ type: 'open', request: direct });
      },
      files: (id, request) => call<SshFileReply>({ type: 'files', id, request }),
    },
    list: () => call<TerminalInfo[]>({ type: 'list' }),
    read: (id, cursor, token) => call<TerminalRead>({ type: 'read', id, cursor, ...(token ? { token } : {}) }),
    write: (id, data) => command({ type: 'write', id, data }),
    writeBinary: (id, data) => command({ type: 'writeBinary', id, data }),
    binaryMode: (id, token, enabled) => call<void>({ type: 'binaryMode', id, token, enabled }),
    resize: (id, size) => command({ type: 'resize', id, size }),
    close: id => command({ type: 'close', id }),
    open: async () => { throw new Error('client.ssh.directConnectionRequired'); },
    link: async () => { throw new Error('client.ssh.directConnectionRequired'); },
  };
  return { client, async dispose() {
    if (disposed) return;
    disposed = true;
    // Drain opens before disposal so a late handshake cannot leave an orphaned socket.
    await Promise.allSettled([...pending]);
    if (options.bridge) await send({ type: 'dispose' });
  } };
}
