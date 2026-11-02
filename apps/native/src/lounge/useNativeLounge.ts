import { useMemo } from 'react';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { LoungeController } from '../../../../shared/lounge/controller';
import { nativeLoungeAvatars } from './avatarStore';
import type { LoungeRuntime } from '../../../../shared/lounge/runtime';
import { useLounge } from '../../../../shared/lounge/useLounge';
import { authorizedRequest } from '../api/client';
import type { AuthSession } from '../types';
import { nativeLoungeHistory } from './historyStore';
import { nativeLoungeSync } from './syncTransport';
import { nativeAttachmentImages } from './attachments';
import { useLoungeDownloads } from './useLoungeDownloads';

export const nativeLoungeRuntime: LoungeRuntime = {
  randomId: randomUUID,
  isVisible: () => AppState.currentState === 'active',
  subscribe(wake) {
    const subscription = AppState.addEventListener('change', wake);
    return () => subscription.remove();
  },
};

export function useNativeLounge(session: AuthSession | null) {
  const controller = useMemo(() => new LoungeController(session ? {
    sync: nativeLoungeSync,
    attachmentImages: nativeAttachmentImages(JSON.stringify([session.baseUrl, session.email])),
    baseUrl: session.baseUrl, userId: session.profile?.id, account: session.email,
    avatars: nativeLoungeAvatars(session.baseUrl),
    history: nativeLoungeHistory(session.baseUrl, session.email),
    authorize: async () => {
      const response = await authorizedRequest(session, '/lounge/ticket', { method: 'POST' });
      if (!response.ok) throw new Error('client.lounge.unavailable');
      return response.json() as Promise<{ ticket: string }>;
    },
  } : undefined, nativeLoungeRuntime), [session]);
  const state = useLounge(controller);
  useLoungeDownloads(controller, session);
  return { controller, state };
}
