import { uiText } from "../../../../../shared/localization/uiText";
import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { invoke, isDesktopApp } from "../../api/backend";
import type { AttachmentReference } from "../../../../../shared/conversation/attachmentTypes";
import { readClipboardImages } from "./clipboardImages";
import { MISSING_CLIPBOARD_IMAGES, readPastedContent } from "../../../../../shared/chat/clipboard";
import { pastedTextFile } from "../../../../../shared/chat/pastedText";
import { usePastedTextAttachment } from "./usePastedTextAttachment";

interface PasteOptions {
  key: string;
  addAttachments: (items: AttachmentReference[]) => void;
  addImages: (files: File[]) => void;
  report: (message: string) => void;
}
interface PendingPaste { fallback?: () => void | Promise<void> }

/** Native file copies may not produce a WebView paste event; also listen for the paste shortcut. */
export function useFilePaste({ key, addAttachments, addImages, report }: PasteOptions) {
  const pending = useRef(new Map<string, PendingPaste>());
  const [reading, setReading] = useState<Record<string, boolean>>({});
  const textAttachment = usePastedTextAttachment({ key, addAttachments, report });
  const readNative = () => {
    const existing = pending.current.get(key);
    if (existing) return existing;
    const request: PendingPaste = {};
    pending.current.set(key, request);
    setReading((values) => ({ ...values, [key]: true }));
    void invoke<AttachmentReference[]>("codex_gui_clipboard_files").then((files) => {
      if (files.length) addAttachments(files);
      else return request.fallback?.();
    }).catch(() => {
      if (request.fallback) return request.fallback();
      else report(uiText("client.workspaceActions.couldNotPasteFilesCopyThemAgainAndRetry"));
    }).finally(() => {
      pending.current.delete(key);
      setReading((values) => ({ ...values, [key]: false }));
    });
    return request;
  };
  const pasteKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const shortcut = ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v")
      || (event.shiftKey && event.key === "Insert");
    if (isDesktopApp && shortcut && !event.altKey && !event.repeat) readNative();
  };
  const paste = (event: ClipboardEvent<HTMLElement>) => {
    const { files, text, hasImages, missingImages } = readPastedContent(event.clipboardData);
    const textFile = pastedTextFile(text);
    if (textFile) {
      event.preventDefault();
      void textAttachment.add(textFile);
    }
    if (!files.length && text && !hasImages) {
      const request = pending.current.get(key);
      // Plain text needs no native fallback, even if the clipboard is temporarily busy.
      if (request) request.fallback = () => {};
      return;
    }
    const fallback = async () => {
      let images = files.filter((file) => file.type.startsWith("image/"));
      let missing = missingImages;
      // Preserve browser-only images that the native clipboard cannot reproduce.
      if (isDesktopApp && missingImages && !images.length) {
        try {
          const native = await readClipboardImages();
          if (native.length) { images = native; missing = false; }
        } catch { /* Keep browser images and report unavailable rich-text images below. */ }
      }
      if (images.length) addImages(images);
      if (missing) report(MISSING_CLIPBOARD_IMAGES);
      if (files.some((file) => !file.type.startsWith("image/"))) report(uiText("client.workspaceActions.useAddFileToSelectTheseFiles"));
    };
    if (isDesktopApp) {
      // SkillInput inserts the accompanying text synchronously at the current caret.
      if (!text) event.preventDefault();
      const request = readNative();
      if (files.length || hasImages) request.fallback = fallback;
    } else if (files.length || hasImages) {
      if (!text) event.preventDefault();
      fallback();
    }
  };
  return { paste, pasteKeyDown, readingFiles: Boolean(reading[key]) || textAttachment.reading };
}
