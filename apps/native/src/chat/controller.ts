import type { AuthSession } from '../types';
import { ChatController as SharedController } from '../../../../shared/remote-chat/client/controller';
import { MobileChatConnection } from './connection';
import { SqliteHistoryStore } from './offline/store';
import { createHistoryPreparer } from './historyPreparation';
import { AsyncHistoryVersionCache } from '../../../../shared/remote-chat/client/historyPreparation';
import { Platform } from 'react-native';
import { createPreviewDownloads } from '../downloads/previews';
import { downloadOwner } from '../downloads/manager';
import { createIosPreviewDownloads } from '../downloads/iosPreviews';

export class ChatController extends SharedController {
  constructor(session: AuthSession, deviceId: string) {
    const prepare = createHistoryPreparer();
    super((events) => new MobileChatConnection({ session, deviceId, ...events }),
      new SqliteHistoryStore(session, deviceId, prepare), prepare ? new AsyncHistoryVersionCache(prepare) : undefined);
    if (Platform.OS === 'android') {
      this.previewDownloads = createPreviewDownloads({ owner: downloadOwner(session), deviceId });
    } else this.previewDownloads = createIosPreviewDownloads(this, { owner: downloadOwner(session), deviceId });
  }
}
