import { useEffect, useRef, useState } from "react";
import { useFilePaste } from "./useFilePaste";
import { uiText } from "../../../../../shared/localization/uiText";
import type { GuiController } from "./controller";
import type { ComposerText } from "../../../../../shared/conversation/types";
import { attachmentKey, MAX_ATTACHMENTS, type AttachmentReference } from "../../../../../shared/conversation/attachmentTypes";
import { validateUploadedFiles } from "../../../../../shared/remote-chat/composerAttachments";
import { MAX_REPLY_QUOTES, MAX_QUOTE_CHARACTERS, quoteKey, quotedReply, type ReplyQuote } from "../../../../../shared/conversation/replyQuotes";
import { queuedMessageText } from "../../../../../shared/conversation/queuedMessageDraft";
import { MAX_CONVERSATION_REFERENCES } from "../../../../../shared/conversation/conversationReferences";

import { IMAGE_TYPES, MAX_IMAGES, MAX_IMAGE_BYTES, readImage, type DraftImage } from "./draftImages";
export { IMAGE_TYPES, MAX_IMAGES, MAX_IMAGE_BYTES, readImage, type DraftImage } from "./draftImages";
interface Draft extends ComposerText {
  images: DraftImage[];
  attachments?: AttachmentReference[];
  quotes?: ReplyQuote[];
}
const EMPTY_DRAFT: Draft = { text: "", mentions: [], images: [] };

export function useComposerDraft(key: string, controller: GuiController) {
  const submitting = useRef(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const recovered = controller.messageEditor.recoveredDrafts.get(key);
  useEffect(() => {
    if (!recovered || controller.messageEditor.recoveredDrafts.get(key) !== recovered) return;
    controller.messageEditor.recoveredDrafts.delete(key);
    setDrafts((values) => {
      const previous = values[key] ?? EMPTY_DRAFT;
      const restored = queuedMessageText(recovered);
      const prefix = previous.text + (previous.text && restored.text ? "\n\n" : "");
      const mentions = restored.mentions.map((mention) => ({ ...mention,
        start: mention.start + prefix.length, end: mention.end + prefix.length }));
      return { ...values, [key]: { ...previous, text: prefix + restored.text,
        mentions: [...previous.mentions, ...mentions],
        attachments: [...(previous.attachments ?? []), ...(recovered.attachments ?? [])],
        images: [...previous.images, ...recovered.images.map((url) =>
          ({ id: crypto.randomUUID(), name: uiText("client.chat.image"), url }))] } };
    });
  }, [controller, key, recovered]);
  const draft = drafts[key] ?? EMPTY_DRAFT;
  const latestDrafts = useRef(drafts);
  latestDrafts.current = drafts;
  const update = (change: (value: Draft) => Draft) => {
    const values = latestDrafts.current;
    latestDrafts.current = { ...values, [key]: change(values[key] ?? EMPTY_DRAFT) };
    setDrafts(latestDrafts.current);
  };
  const editText = (text: string) => update((value) => ({ ...value, text, mentions: [] }));
  const editContent = (content: ComposerText) => update((value) => ({ ...value, ...content }));
  const appendDictation = (text: string) => {
    if (!text.trim()) return;
    update((value) => ({ ...value,
      text: value.text + (value.text && !/\s$/.test(value.text) ? "\n" : "") + text.trim() }));
  };
  const editQueued = (id: string) => {
    if (submitting.current) return false;
    const message = controller.queue.take(key, id);
    if (!message) return false;
    const restored: Draft = { ...queuedMessageText(message), attachments: message.attachments,
      images: message.images.map((url, index) => ({ id: crypto.randomUUID(),
        name: uiText("client.desktopComposerExtras.image", { value1: index + 1 }), url })) };
    update(() => restored);
    return true;
  };
  const addQuote = (quote: ReplyQuote) => {
    if (!quote.text.trim() || !quote.messageId) return false;
    if (quote.text.length > MAX_QUOTE_CHARACTERS) {
      controller.report("引用内容太长，请选择短一些的片段。"); return false;
    }
    if (draft.quotes?.some((item) => quoteKey(item) === quoteKey(quote))) return true;
    if ((draft.quotes?.length ?? 0) >= MAX_REPLY_QUOTES) {
      controller.report("每条消息最多添加 8 条引用。"); return false;
    }
    update((value) => ({ ...value, quotes: [...new Map([...(value.quotes ?? []), quote]
      .map((item) => [quoteKey(item), item])).values()].slice(0, MAX_REPLY_QUOTES) }));
    return true;
  };
  const removeQuote = (key: string) => update((value) =>
    ({ ...value, quotes: value.quotes?.filter((item) => quoteKey(item) !== key) }));
  const clearQuotes = () => update((value) => ({ ...value, quotes: [] }));
  const addAttachments = (attachments: AttachmentReference[]) => {
    const current = latestDrafts.current[key] ?? EMPTY_DRAFT;
    const combined = [...new Map([...(current.attachments ?? []), ...attachments]
      .map((item) => [attachmentKey(item), item])).values()];
    if (combined.filter((item) => item.kind === "conversation").length > MAX_CONVERSATION_REFERENCES) {
      controller.report("每条消息最多引用 8 个对话。"); return false;
    }
    if (combined.length > MAX_ATTACHMENTS) {
      controller.report("每条消息最多添加 32 个附件或对话引用。"); return false;
    }
    try { validateUploadedFiles(combined, 'relay'); }
    catch (cause) {
      controller.report(cause instanceof Error ? cause.message : "文件粘贴失败，请重新复制后再试。"); return false;
    }
    update((value) => ({ ...value, attachments: combined }));
    return true;
  };
  const removeAttachment = (path: string) => update((value) =>
    ({ ...value, attachments: value.attachments?.filter((item) => attachmentKey(item) !== path) }));
  const removeImage = (id: string) => update((value) =>
    ({ ...value, images: value.images.filter((image) => image.id !== id) }));
  const editImage = (id: string, url: string) => update((value) =>
    ({ ...value, images: value.images.map((image) => image.id === id ? { ...image, url } : image) }));
  const addImages = (files: File[]) => {
    const valid = files.filter((file) => IMAGE_TYPES.includes(file.type) && file.size > 0
      && file.size <= MAX_IMAGE_BYTES);
    if (valid.length !== files.length) controller.report("请添加 PNG、JPG、WebP 或 GIF 图片，每张不超过 20 MB。");
    if (valid.length + draft.images.length > MAX_IMAGES) controller.report("每条消息最多添加 8 张图片。");
    const additions = valid.slice(0, MAX_IMAGES - draft.images.length)
      .map((file) => ({ file, id: crypto.randomUUID() }));
    update((value) => ({ ...value, images: [...value.images,
      ...additions.map(({ file, id }) => ({ id, name: file.name }))].slice(0, MAX_IMAGES) }));
    for (const { file, id } of additions) {
      void readImage(file).then((url) => update((value) => ({ ...value,
        images: value.images.map((image) => image.id === id ? { ...image, url } : image) })))
        .catch(() => { removeImage(id); controller.report("图片读取失败，请重新粘贴或选择图片。"); });
    }
  };
  const { paste, pasteKeyDown, readingFiles } = useFilePaste({ key, addAttachments, addImages,
    report: controller.report });
  const reading = readingFiles || draft.images.some((image) => !image.url);
  const send = async (goalMode = false, onAccepted?: () => void) => {
    if (reading || submitting.current) return;
    if (goalMode && (!draft.text.trim() || draft.text.length > 4000
      || draft.images.length || draft.attachments?.length || draft.mentions.length)) {
      controller.report("请用 4000 字以内的文字描述目标；图片、文件和技能可退出目标模式后发送。");
      return;
    }
    submitting.current = true;
    const skills = [...new Map(draft.mentions.map(({ skill }) =>
      [skill.path, { name: skill.name, path: skill.path }])).values()];
    try {
      const images = draft.images.flatMap((image) => image.url ? [image.url] : []);
      const text = quotedReply(draft.text, draft.quotes);
      const accepted = goalMode ? await controller.goals.set({ objective: text, status: "active" })
        : draft.attachments?.length
        ? await controller.send(text, images, skills, draft.attachments)
        : await controller.send(text, images, skills);
      if (accepted) {
        setDrafts((values) => values[key] === draft ? { ...values, [key]: EMPTY_DRAFT } : values);
        onAccepted?.();
      } else {
        const selected = key === "new" ? controller.getSnapshot().selected ?? "new" : key;
        setDrafts((values) => values[key] !== draft || selected === key || values[selected]
          ? values : { ...values, [key]: EMPTY_DRAFT, [selected]: draft });
      }
    } finally { submitting.current = false; }
  };
  return { draft, reading, editText, editContent, appendDictation, removeImage, editImage, addImages, paste, pasteKeyDown,
    send, addAttachments, removeAttachment,
    addQuote, removeQuote, clearQuotes, editQueued };
}
