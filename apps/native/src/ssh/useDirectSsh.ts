import { useEffect, useMemo } from 'react';
import { NativeModules } from 'react-native';
import { randomUUID } from 'expo-crypto';
import type { AuthSession } from '../types';
import { createNativeSshProfiles } from '../api/sshProfiles';
import { createDirectSshClient, type DirectSshBridge } from './directClient';

/** Keep SSH alive while navigating; sign-out and account replacement release every owned connection. */
export function useDirectSsh(session: AuthSession | null) {
  const connection = useMemo(() => session ? createDirectSshClient({ scope: randomUUID(),
    bridge: NativeModules.DirectSsh as DirectSshBridge | undefined, profiles: createNativeSshProfiles(session),
  }) : undefined, [session]);
  useEffect(() => () => {
    void connection?.dispose().catch(() => {
      // The platform bridge also closes its sessions when React Native invalidates it.
    });
  }, [connection]);
  return connection?.client;
}
