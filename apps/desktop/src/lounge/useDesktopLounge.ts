import { browserAttachmentImages } from '../../../../shared/lounge/attachmentCache';
import { browserAttachmentSink } from '../../../../shared/lounge/browserAttachments';
import { useMemo } from 'react';
import { LoungeController } from '../../../../shared/lounge/controller';
import { browserAvatarStore } from '../../../../shared/lounge/avatar';
import { browserLoungeHistory } from '../../../../shared/lounge/browserHistory';
import { useLounge } from '../../../../shared/lounge/useLounge';
import { browserLoungeSync } from '../../../../shared/lounge/browserSync';
import { invoke } from '../api/backend';
import type { CloudAuthState } from '../types';
import { useBrowserLoungeDownloads } from '../../../../shared/lounge/useBrowserLoungeDownloads';
import { authenticatedDownloadOwner } from '../downloads/useDesktopDownloads';
import { version } from '../../package.json';

export function useDesktopLounge(auth: CloudAuthState) {
  const { authenticated, baseUrl, userId, userEmail } = auth;
  const controller = useMemo(() => new LoungeController(authenticated && baseUrl && userId ? {
    sync: browserLoungeSync,
    clientVersion: version,
    clientPlatform: 'desktop',
    attachmentImages: browserAttachmentImages(JSON.stringify([baseUrl, userId]), browserAttachmentSink),
    baseUrl, userId, account: userEmail || undefined, avatars: browserAvatarStore(baseUrl),
    history: browserLoungeHistory(baseUrl, userEmail || userId),
    authorize: () => invoke<{ ticket: string }>('cloud_lounge_ticket', { identity: { baseUrl, userId } }),
  } : undefined), [authenticated, baseUrl, userId, userEmail]);
  const state = useLounge(controller);
  useBrowserLoungeDownloads(controller, authenticatedDownloadOwner(auth));
  return { controller, state };
}
