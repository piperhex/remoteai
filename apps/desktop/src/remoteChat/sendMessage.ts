import { guiApi } from '../../../../shared/conversation/api';
import { getGuiController } from '../pages/codexGui/session';
import type { Request, Turn } from '../../../../shared/conversation/types';

/** The host owns send receipts so every viewer and subsequent history read sees the same message. */
export async function sendRemoteMessage(request: Extract<Request, { operation: 'send' }>) {
  const controller = getGuiController();
  const release = controller.retainConversation(request.threadId);
  try {
    if (controller.getSnapshot().connection !== 'ready') await controller.connect({ reuseExisting: true });
    // thread/started already supplies a new thread; its history may not be readable until the first send.
    if (!controller.getSnapshot().conversations[request.threadId]) await controller.loadRemoteThread(request.threadId);
    const result = await guiApi.request<{ turn: Turn }>(request);
    controller.acceptSentTurn(request.threadId, result.turn, { text: request.text,
      images: request.images ?? [], skills: request.skills ?? [], attachments: request.attachments });
    return result;
  } finally { release(); }
}
