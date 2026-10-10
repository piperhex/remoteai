import { getGuiController } from '../pages/codexGui/session';
import { composerPatch } from '../../../../shared/remote-chat/composer';
import { queueTextPreview, type QueueSnapshot, type QueueEnqueueResult } from '../../../../shared/remote-chat/queue';
import type { GuiController } from '../pages/codexGui/controller';
import type { GuiState, SkillReference } from '../pages/codexGui/types';
import { remoteAttachments } from '../../../../shared/remote-chat/composerAttachments';
import { validateChatImages } from '../../../../shared/remote-chat/attachments';
import type { QueueEditResult } from '../../../../shared/remote-chat/queue';
import { chunks } from '../../../../shared/remote-chat/framing';
import type { ConnectionMode } from '../../../../shared/remote-chat/protocol';

const MAX_TEXT_LENGTH = 100_000;
const MAX_IMAGES = 12;
const MAX_IMAGE_LENGTH = 8 * 1024 * 1024;
const MAX_SKILLS = 100;
const MAX_SKILL_PATH_LENGTH = 4096;
const MAX_REQUEST_ID_LENGTH = 160;

function skillInput(value: unknown): SkillReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_SKILLS) throw new Error('技能内容无效，请重新选择。');
  return value.map((skill: unknown) => {
    const fields = skill && typeof skill === 'object' ? skill as Record<string, unknown> : {};
    if (typeof fields.name !== 'string' || !fields.name.trim() || fields.name.length > 200
      || typeof fields.path !== 'string' || !fields.path.trim() || fields.path.length > MAX_SKILL_PATH_LENGTH) {
      throw new Error('技能内容无效，请重新选择。');
    }
    return { name: fields.name, path: fields.path };
  });
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new Error('消息已不可用，请刷新聊天。');
  }
  return value;
}

function messageInput(body: Record<string, unknown>, mode: ConnectionMode) {
  const { text, images = [] } = body;
  const skills = skillInput(body.skills);
  const attachments = remoteAttachments(body.attachments, mode);
  if (typeof text !== 'string' || (mode !== 'direct' && text.length > MAX_TEXT_LENGTH) || !Array.isArray(images)
    || images.length > MAX_IMAGES || images.some((image) => typeof image !== 'string'
      || (mode !== 'direct' && image.length > MAX_IMAGE_LENGTH)
      || !/^data:image\/(png|jpeg|webp|gif);base64,/.test(image))
    || (!text.trim() && !images.length && !skills.length && !attachments.length)) {
    throw new Error('消息内容无效，请检查后重试。');
  }
  return { text, images: images as string[], skills, ...(mode === 'direct' ? { transferMode: 'direct' as const } : {}),
    ...(attachments.length ? { attachments } : {}) };
}

/** Adapts the PC queue to compact remote snapshots; transport retries are deduplicated by ChatOperations. */
export class RemoteQueue {
  private source?: GuiState['queued'];
  private snapshot: QueueSnapshot = { revision: 0, threads: {} };
  constructor(private controller: () => GuiController = getGuiController) {}

  read = (): QueueSnapshot => {
    const source = this.controller().getSnapshot().queued;
    if (source === this.source) return this.snapshot;
    this.source = source;
    this.snapshot = { revision: this.snapshot.revision + 1,
      cancelledIds: [...this.controller().queue.cancelledMessages()],
      threads: Object.fromEntries(Object.entries(source).filter(([, messages]) => messages.length)
        .map(([id, messages]) => [id, messages.map((item) => ({
          id: item.id, text: queueTextPreview(item.text || item.attachments?.map((file) => file.name).join('、') || ''),
          imageCount: item.images.length, attachmentCount: item.attachments?.length ?? 0,
          busy: Boolean(item.busy), error: item.error,
        }))])) };
    return this.snapshot;
  };

  subscribe(listener: (snapshot: QueueSnapshot) => void) {
    this.read();
    return this.controller().subscribe(() => {
      const previous = this.snapshot;
      const snapshot = this.read();
      if (previous !== snapshot) listener(snapshot);
    });
  }

  async request(body: Record<string, unknown>, mode: ConnectionMode = 'relay'): Promise<QueueSnapshot> {
    const controller = this.controller();
    if (controller.getSnapshot().connection !== 'ready') await controller.connect({ reuseExisting: true });
    if (controller.getSnapshot().connection !== 'ready') throw new Error('电脑暂未就绪，请稍后重试。');
    if (body.operation === 'queueRead') return this.read();
    const threadId = identifier(body.threadId);
    if (body.operation === 'queueEnqueue') return this.enqueue(controller, threadId, body, mode);
    if (body.operation === 'queueFlush') await controller.queue.flush(threadId, true);
    else {
      const id = identifier(body.id);
      if (body.operation === 'queueEdit') return this.edit({ controller, threadId, id, mode });
      if (body.operation === 'queueMoveUp' || body.operation === 'queueMoveDown') {
        controller.queue.move(threadId, id, body.operation === 'queueMoveUp' ? 'up' : 'down');
      } else if (body.operation === 'queueRemove') controller.queue.remove(threadId, id);
      else if (body.operation === 'queueSendNow') {
        if (controller.getSnapshot().conversations[threadId]?.activeTurn) await controller.queue.steer(threadId, id);
        else await controller.queue.flush(threadId, true);
      } else throw new Error('当前手机端暂不支持此操作。');
    }
    await controller.queueJournal.saved();
    return this.read();
  }

  private async edit({ controller, threadId, id, mode }: {
    controller: GuiController; threadId: string; id: string; mode: ConnectionMode;
  }): Promise<QueueEditResult> {
    const item = controller.getSnapshot().queued[threadId]?.find((message) => message.id === id);
    if (!item || item.busy) throw new Error('这条消息已开始发送或已被移除。');
    // Validate before removing: a desktop-only or oversized image must not lose the queued message.
    validateChatImages(item.images, mode);
    remoteAttachments(item.attachments, mode);
    const { text, images, skills, attachments } = item;
    chunks({ kind: 'response', id: 'x'.repeat(MAX_REQUEST_ID_LENGTH), data: {
      ...this.read(), draft: { text, images, skills, attachments },
    } }, 'queue-edit', mode).next();
    const draft = controller.queue.take(threadId, id);
    if (!draft) throw new Error('这条消息已开始发送或已被移除。');
    await controller.queueJournal.saved();
    return { ...this.read(), draft };
  }

  private async enqueue(controller: GuiController, threadId: string,
    body: Record<string, unknown>, mode: ConnectionMode): Promise<QueueEnqueueResult> {
    const input = messageInput(body, mode);
    const patch = composerPatch(Object.fromEntries(['model', 'effort', 'access']
      .filter((key) => body[key] !== undefined).map((key) => [key, body[key]])));
    await controller.loadRemoteThread(threadId);
    await controller.modelCatalog.ready();
    const selected = await controller.modelSettings.ready(threadId);
    if ((patch.model && patch.model !== selected.model) || (patch.effort && patch.effort !== selected.effort)) {
      throw new Error('模型已更新，请确认后重新发送。');
    }
    const settings = { ...controller.getSnapshot().settings, ...patch, ...selected };
    if (!controller.queue.enqueue(threadId, input, settings)) throw new Error('待发送消息已满，请稍后再添加。');
    const enqueuedId = controller.getSnapshot().queued[threadId].at(-1)?.id;
    try { await controller.queueJournal.saved(); }
    catch {
      controller.queue.hold(threadId);
      throw new Error('保存结果尚未确认，请先检查电脑上的待发送消息。');
    }
    void controller.queue.flush(threadId);
    return { ...this.read(), enqueuedId };
  }
}

export const remoteQueue = new RemoteQueue();
